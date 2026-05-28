#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hebbs CLI entry. Currently exposes `hebbs test <module>` — boots a
// headless host against the module, optionally dispatches one smoke
// tool, and reports.
//
// MDK T4.2.

import { runTest } from "./test.js";

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
      "  hebbs test <module> [options]",
      "",
      "Arguments:",
      "  <module>           path to a .hebbsmod archive OR a built module package",
      "                     (a directory containing index.mjs + module.json)",
      "",
      "Options:",
      "  --tool <name>      dispatch a smoke tool after install (e.g. crm.contacts.create)",
      "  --inputs <json>    JSON inputs for --tool (default: {})",
      "  --json             emit a machine-readable JSON result",
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
  if (args.command !== "test") {
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

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `hebbs: unhandled error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
