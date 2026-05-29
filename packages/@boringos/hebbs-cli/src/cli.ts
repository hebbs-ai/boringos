#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hebbs CLI entry. Currently exposes `hebbs test <module>` — boots a
// headless host against the module, optionally dispatches one smoke
// tool, and reports.
//
// MDK T4.2.

import { runTest } from "./test.js";
import { startDev } from "./dev.js";

interface ParsedArgs {
  command: string | null;
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  let command: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i === 0 && !a.startsWith("-")) {
      command = a;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith("-")) {
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

function printHelp(): void {
  process.stdout.write(
    [
      "hebbs — module dev kit CLI",
      "",
      "Usage:",
      "  hebbs test <module> [options]   one-shot smoke (boot, optional dispatch, tear down)",
      "  hebbs dev  <module> [options]   boot and stay alive (Ctrl+C to stop) — MDK T6.1",
      "",
      "Arguments:",
      "  <module>           path to a .hebbsmod archive OR a built module package",
      "                     (a directory containing index.mjs + module.json)",
      "",
      "Options (both commands):",
      "  --tool <name>      dispatch a smoke tool after install (e.g. crm.contacts.create)",
      "  --inputs <json>    JSON inputs for --tool (default: {})",
      "  --json             emit a machine-readable JSON result (test only)",
      "  --no-watch         dev only: disable file-watcher hot reload",
      "  --postgres-url <u> use an external Postgres (e.g. recipes/docker/) instead of embedded",
      "  --help, -h         print this message",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || args.flags.h) {
    printHelp();
    return 0;
  }
  if (args.command !== "test" && args.command !== "dev") {
    process.stderr.write(
      `hebbs: unknown command "${args.command ?? "(none)"}"\n\n`,
    );
    printHelp();
    return 2;
  }

  const modulePath = args.positional[0];
  if (!modulePath) {
    process.stderr.write("hebbs test: <module> argument is required\n\n");
    printHelp();
    return 2;
  }

  const smokeToolName =
    typeof args.flags.tool === "string" ? args.flags.tool : undefined;
  let smokeToolInputs: unknown = {};
  if (typeof args.flags.inputs === "string") {
    try {
      smokeToolInputs = JSON.parse(args.flags.inputs);
    } catch (err) {
      process.stderr.write(
        `hebbs test: --inputs must be valid JSON. ${(err as Error).message}\n`,
      );
      return 2;
    }
  }

  if (args.command === "dev") {
    const noWatch = args.flags["no-watch"] === true;
    const postgresUrl =
      typeof args.flags["postgres-url"] === "string"
        ? args.flags["postgres-url"]
        : process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0
          ? process.env.DATABASE_URL
          : undefined;
    return runDev(
      modulePath,
      smokeToolName,
      smokeToolInputs,
      !noWatch,
      postgresUrl,
    );
  }

  const wantJson = args.flags.json === true;
  const result = await runTest({
    modulePath,
    smokeToolName,
    smokeToolInputs,
  });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.ok) {
      process.stdout.write(
        [
          `✓ hebbs test — ${result.moduleId}@${result.moduleVersion}`,
          `  boot:   ${result.bootMs}ms`,
          result.smoke
            ? `  smoke:  ${result.smoke.toolName} → ${JSON.stringify(result.smoke.response)}`
            : `  smoke:  (none requested)`,
          "",
        ].join("\n"),
      );
    } else {
      process.stderr.write(
        [
          `✗ hebbs test FAILED`,
          `  boot:  ${result.bootMs}ms`,
          `  error: ${result.error ?? "(no message)"}`,
          "",
        ].join("\n"),
      );
    }
  }

  return result.ok ? 0 : 1;
}

async function runDev(
  modulePath: string,
  smokeToolName?: string,
  smokeToolInputs?: unknown,
  watch: boolean = true,
  postgresUrl?: string,
): Promise<number> {
  try {
    const handle = await startDev({
      modulePath,
      smokeToolName,
      smokeToolInputs,
      watch: watch ? "auto" : false,
      postgresUrl,
      onReload: (r) => {
        process.stdout.write(
          `  ↻ reloaded ${r.moduleId}@${r.moduleVersion} ` +
            `(tools ${r.toolsRemoved}→${r.toolsAdded}, ` +
            `skills ${r.skillsRemoved}→${r.skillsAdded}, ` +
            `${r.durationMs}ms)\n`,
        );
      },
    });
    process.stdout.write(
      [
        ``,
        `▶ hebbs dev — ${handle.host.moduleId}@${handle.host.moduleVersion}`,
        ``,
        `  url:        ${handle.host.url}`,
        `  tenant id:  ${handle.host.tenantId}`,
        `  jwt:        ${handle.host.callbackToken.slice(0, 24)}…  (Authorization: Bearer)`,
        `  watch:      ${handle.watching ? "on (edit files to reload)" : "off"}`,
        `  postgres:   ${postgresUrl ? "external (--postgres-url / $DATABASE_URL)" : "embedded"}`,
        ``,
        `  Try a tool:`,
        `    curl -X POST '${handle.host.url}/api/tools/${handle.host.moduleId}.greet' \\`,
        `      -H "Authorization: Bearer ${handle.host.callbackToken.slice(0, 24)}…" \\`,
        `      -H 'Content-Type: application/json' \\`,
        `      -d '{"name":"Ada"}'`,
        ``,
        `  Ctrl+C to shut down.`,
        ``,
      ].join("\n"),
    );

    let shuttingDown = false;
    const close = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.stdout.write(`\n  caught ${signal} — shutting down…\n`);
      await handle.shutdown();
      process.exit(0);
    };
    process.on("SIGINT", () => {
      void close("SIGINT");
    });
    process.on("SIGTERM", () => {
      void close("SIGTERM");
    });

    // Keep the event loop alive until a signal arrives.
    await new Promise<void>(() => {
      /* never resolves; signal handlers exit */
    });
    return 0;
  } catch (err) {
    process.stderr.write(
      `✗ hebbs dev FAILED — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `hebbs: unhandled error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
