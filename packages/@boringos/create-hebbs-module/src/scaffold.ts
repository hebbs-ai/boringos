// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generate a minimum-viable Hebbs module on disk. Today (T5.1) the
// emitted module ships ONE tool + ONE skill — enough that
// `hebbs test` can boot it green. T5.2 extends this with the full
// "one-of-each" template (UI, widget, seeded agent / workflow /
// routine, demo schema).

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

export interface ScaffoldOptions {
  /** Module id — must be `^[a-z][a-z0-9-]*$`. Becomes `<id>`
   *  everywhere in the generated files. */
  id: string;
  /** Directory the module is emitted into. Created if missing.
   *  Must not already contain a `module.json` (the scaffolder
   *  refuses to overwrite an existing module). */
  targetDir: string;
  /** Human-readable name for `module.json.name`. Defaults to the
   *  id with the first character capitalized. */
  displayName?: string;
  /** One-line description for `module.json.description`. */
  description?: string;
  /** Minimum framework version the module declares. Defaults to
   *  the current published `@boringos/module-sdk`-compatible
   *  baseline. */
  minFrameworkVersion?: string;
}

export interface ScaffoldResult {
  /** Absolute path of the scaffolded module dir. */
  targetDir: string;
  /** Module id baked into the templates. */
  id: string;
  /** Files written, relative to `targetDir`. */
  files: string[];
}

const DEFAULT_MIN_FRAMEWORK = "0.1.0";

/**
 * Scaffold a Hebbs module on disk.
 *
 * Throws on:
 *  - invalid id (must be `[a-z][a-z0-9-]*`)
 *  - target dir already contains a `module.json`
 */
export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!MODULE_ID_RE.test(opts.id)) {
    throw new Error(
      `create-hebbs-module: invalid id "${opts.id}". Must match /^[a-z][a-z0-9-]*$/.`,
    );
  }
  const targetDir = resolve(opts.targetDir);
  if (existsSync(join(targetDir, "module.json"))) {
    throw new Error(
      `create-hebbs-module: refusing to overwrite — ${targetDir} already contains a module.json.`,
    );
  }

  const displayName =
    opts.displayName ?? opts.id.charAt(0).toUpperCase() + opts.id.slice(1);
  const description =
    opts.description ??
    `${displayName} — scaffolded by create-hebbs-module.`;
  const minFrameworkVersion =
    opts.minFrameworkVersion ?? DEFAULT_MIN_FRAMEWORK;

  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, "src"), { recursive: true });
  await mkdir(join(targetDir, "src", "migrations"), { recursive: true });
  await mkdir(join(targetDir, "src", "skills"), { recursive: true });

  const files: string[] = [];
  const tableName = `${opts.id.replace(/-/g, "_")}__demo`;

  // ── module.json ───────────────────────────────────────────
  await writeFile(
    join(targetDir, "module.json"),
    JSON.stringify(
      {
        id: opts.id,
        version: "0.1.0",
        kind: "module",
        name: displayName,
        description,
        entry: "./index.mjs",
        minFrameworkVersion,
        publisher: { id: "your-publisher-id", name: "Your Publisher" },
        license: "MIT",
      },
      null,
      2,
    ) + "\n",
  );
  files.push("module.json");

  // ── package.json ──────────────────────────────────────────
  await writeFile(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: opts.id,
        version: "0.1.0",
        private: true,
        type: "module",
        main: "./dist/index.js",
        scripts: {
          build: "tsc",
          test: "hebbs test .",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          "@boringos/module-sdk": "^0.10.0",
        },
        devDependencies: {
          "@boringos/hebbs-cli": "^0.1.0",
          "@types/node": "^22.0.0",
          typescript: "^5.7.3",
        },
      },
      null,
      2,
    ) + "\n",
  );
  files.push("package.json");

  // ── tsconfig.json ─────────────────────────────────────────
  await writeFile(
    join(targetDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
          outDir: "dist",
          rootDir: "src",
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  );
  files.push("tsconfig.json");

  // ── src/module.ts (one-of-each surface — T5.2) ─────────────
  const factory = `create${pascal(opts.id)}Module`;
  await writeFile(
    join(targetDir, "src", "module.ts"),
    [
      `// ${displayName} — scaffolded by create-hebbs-module.`,
      `//`,
      `// One-of-each surface (T5.2): a tool, a skill file ref, a demo`,
      `// schema migration, a seeded agent, a seeded workflow, and a`,
      `// cron routine. Trim anything you don't need.`,
      ``,
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { z } from "@boringos/module-sdk";`,
      `import type {`,
      `  Module,`,
      `  ModuleFactory,`,
      `  Migration,`,
      `} from "@boringos/module-sdk";`,
      ``,
      `const __moduleDir = dirname(fileURLToPath(import.meta.url));`,
      ``,
      `const demoMigration: Migration = {`,
      `  id: "${opts.id}_demo_001",`,
      `  async up(db) {`,
      `    await db.execute(\``,
      `      CREATE TABLE IF NOT EXISTS ${tableName} (`,
      `        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `        tenant_id uuid NOT NULL,`,
      `        note text NOT NULL,`,
      `        created_at timestamptz NOT NULL DEFAULT now()`,
      `      )`,
      `    \`);`,
      `  },`,
      `  async down(db) {`,
      `    await db.execute(\`DROP TABLE IF EXISTS ${tableName}\`);`,
      `  },`,
      `};`,
      ``,
      `export const ${factory}: ModuleFactory = () => {`,
      `  const module: Module = {`,
      `    id: "${opts.id}",`,
      `    name: "${displayName}",`,
      `    version: "0.1.0",`,
      `    description: ${JSON.stringify(description)},`,
      `    defaultInstall: false,`,
      ``,
      `    // SKILL.md teaches the agent how to call your tools.`,
      `    skills: ["./skills/${opts.id}.md"],`,
      ``,
      `    // Tools: zod-validated callables the agent dispatches.`,
      `    tools: [`,
      `      {`,
      `        name: "greet",`,
      `        description: "Greet someone by name",`,
      `        inputs: z.object({ name: z.string() }),`,
      `        async handler({ name }: { name: string }) {`,
      `          return {`,
      `            ok: true as const,`,
      `            result: { greeting: \`Hello, \${name}!\` },`,
      `          };`,
      `        },`,
      `      },`,
      `    ],`,
      ``,
      `    // Schema: a single demo table. Tenant-scoped via tenant_id.`,
      `    schema: [demoMigration],`,
      ``,
      `    // One seeded agent — the host hires it on install.`,
      `    agents: [`,
      `      {`,
      `        name: "${displayName} Concierge",`,
      `        persona: "personas-default.assistant",`,
      `        instructions: "Greet visitors and help them with ${opts.id} tasks.",`,
      `        tools: ["${opts.id}.greet"],`,
      `      },`,
      `    ],`,
      ``,
      `    // One seeded workflow — runs a single tool node.`,
      `    workflows: [`,
      `      {`,
      `        name: "${opts.id}.daily_greet",`,
      `        description: "Greet a test user every day.",`,
      `        blocks: [`,
      `          {`,
      `            id: "greet-1",`,
      `            kind: "tool",`,
      `            tool: "${opts.id}.greet",`,
      `            inputs: { name: "Friend" },`,
      `          },`,
      `        ],`,
      `        edges: [],`,
      `      },`,
      `    ],`,
      ``,
      `    // One cron routine — fires the workflow daily at 9am UTC.`,
      `    routines: [`,
      `      {`,
      `        id: "${opts.id}-daily-9am",`,
      `        title: "Daily greet at 9am UTC",`,
      `        trigger: { kind: "cron", cronExpression: "0 9 * * *", timezone: "UTC" },`,
      `        tool: "${opts.id}.greet",`,
      `        inputs: { name: "Friend" },`,
      `      },`,
      `    ],`,
      ``,
      `    __moduleDir,`,
      `  };`,
      `  return module;`,
      `};`,
      ``,
      `export default ${factory};`,
      ``,
    ].join("\n"),
  );
  files.push("src/module.ts");

  // ── src/skills/<id>.md ──────────────────────────────────
  await writeFile(
    join(targetDir, "src", "skills", `${opts.id}.md`),
    [
      `# ${displayName}`,
      ``,
      `Use \`${opts.id}.greet\` to greet someone by name. Pass`,
      `\`{ name: string }\` — returns \`{ greeting: string }\`.`,
      ``,
      `Examples of when this is useful:`,
      `- A user shared their name in copilot; reply with a personalised greeting.`,
      `- A workflow needs to acknowledge an inbound lead.`,
      ``,
    ].join("\n"),
  );
  files.push(`src/skills/${opts.id}.md`);

  // ── src/migrations/001-demo.sql ─────────────────────────
  // The framework reads migrations from Module.schema; this SQL
  // file is kept around as a human-readable record of the demo
  // table for ops + IDE tooling.
  await writeFile(
    join(targetDir, "src", "migrations", "001-demo.sql"),
    [
      `-- ${displayName} demo table.`,
      `--`,
      `-- Mirror of the migration shipped via Module.schema in src/module.ts.`,
      `-- The framework runs the TS version at install time; this file is`,
      `-- here so reviewers and ops can see the DDL in one place.`,
      ``,
      `CREATE TABLE IF NOT EXISTS ${tableName} (`,
      `  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `  tenant_id uuid NOT NULL,`,
      `  note text NOT NULL,`,
      `  created_at timestamptz NOT NULL DEFAULT now()`,
      `);`,
      ``,
    ].join("\n"),
  );
  files.push("src/migrations/001-demo.sql");

  // ── src/index.ts ──────────────────────────────────────────
  await writeFile(
    join(targetDir, "src", "index.ts"),
    `export { create${pascal(opts.id)}Module, default } from "./module.js";\n`,
  );
  files.push("src/index.ts");

  // ── README.md ────────────────────────────────────────────
  await writeFile(
    join(targetDir, "README.md"),
    [
      `# ${displayName}`,
      ``,
      `${description}`,
      ``,
      `## Develop`,
      ``,
      "```bash",
      `pnpm install`,
      `pnpm build`,
      `pnpm test    # boots a headless host and dispatches ${opts.id}.greet`,
      "```",
      ``,
      `## Pack a \`.hebbsmod\``,
      ``,
      "```bash",
      `npx -p @boringos/module-sdk pack-hebbsmod --pkg .`,
      "```",
      ``,
      "Drop the resulting `dist/<id>-<version>.hebbsmod` onto a deployed Hebbs Shell → Settings → Modules → Upload.",
      ``,
    ].join("\n"),
  );
  files.push("README.md");

  // ── .gitignore ───────────────────────────────────────────
  await writeFile(
    join(targetDir, ".gitignore"),
    ["node_modules/", "dist/", ".data/", ""].join("\n"),
  );
  files.push(".gitignore");

  return { targetDir, id: opts.id, files };
}

function pascal(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
