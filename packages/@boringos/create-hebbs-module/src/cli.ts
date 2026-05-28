#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `create-hebbs-module <id> [target-dir]` — scaffolds a Hebbs module
// on disk and prints next steps. Invoked transparently via
// `pnpm create hebbs-module <id>` (npm convention).

import { resolve } from "node:path";
import {
  scaffold,
  TEMPLATES,
  type TemplateName,
} from "./scaffold.js";

function printHelp(): void {
  process.stdout.write(
    [
      "create-hebbs-module — scaffold a Hebbs module",
      "",
      "Usage:",
      "  pnpm create hebbs-module <id> [target-dir]",
      "  create-hebbs-module <id> [target-dir]",
      "",
      "Arguments:",
      "  <id>            module id, must match /^[a-z][a-z0-9-]*$/",
      "  [target-dir]    directory to scaffold into (default: <id>)",
      "",
      "Options:",
      "  --template <name>       one of: " + TEMPLATES.join(", "),
      "                          (default: default — one-of-each surface)",
      "  --name <name>           display name (default: capitalized <id>)",
      "  --description <text>    one-line description",
      "  --min-framework <ver>   minimum framework semver (default: 0.1.0)",
      "  --help, -h              print this message",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return argv.length === 0 ? 2 : 0;
  }

  let id: string | undefined;
  let targetDir: string | undefined;
  let displayName: string | undefined;
  let description: string | undefined;
  let minFrameworkVersion: string | undefined;
  let template: TemplateName | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--template") {
      template = argv[++i] as TemplateName;
    } else if (a === "--name") {
      displayName = argv[++i];
    } else if (a === "--description") {
      description = argv[++i];
    } else if (a === "--min-framework") {
      minFrameworkVersion = argv[++i];
    } else if (a.startsWith("-")) {
      process.stderr.write(`create-hebbs-module: unknown flag ${a}\n`);
      return 2;
    } else if (!id) {
      id = a;
    } else if (!targetDir) {
      targetDir = a;
    }
  }

  if (!id) {
    process.stderr.write("create-hebbs-module: <id> is required\n\n");
    printHelp();
    return 2;
  }

  try {
    const result = await scaffold({
      id,
      targetDir: targetDir ?? id,
      displayName,
      description,
      minFrameworkVersion,
      template,
    });
    const rel = resolve(result.targetDir);
    process.stdout.write(
      [
        ``,
        `✓ scaffolded ${result.id} (${result.template}) in ${rel}`,
        ``,
        `  files:`,
        ...result.files.map((f) => `    ${f}`),
        ``,
        `  next:`,
        `    cd ${result.targetDir}`,
        `    pnpm install`,
        `    pnpm build`,
        `    pnpm test`,
        ``,
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `create-hebbs-module: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `create-hebbs-module: unhandled error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
