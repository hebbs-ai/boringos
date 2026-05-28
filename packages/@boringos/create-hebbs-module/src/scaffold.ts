// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generate a Hebbs module on disk from one of four template recipes
// (MDK T5.3):
//   - `default`             one-of-each surface (tool/skill/schema/
//                           seeded agent/workflow/routine)
//   - `data`                schema-heavy: 2 demo tables + CRUD tools
//   - `agent-only`          a seeded agent + skill, no tools/schema
//   - `connector-consumer`  reads a connector via deps.getConnectorToken

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

export type TemplateName =
  | "default"
  | "data"
  | "agent-only"
  | "connector-consumer";

export const TEMPLATES: readonly TemplateName[] = [
  "default",
  "data",
  "agent-only",
  "connector-consumer",
] as const;

export interface ScaffoldOptions {
  id: string;
  targetDir: string;
  displayName?: string;
  description?: string;
  minFrameworkVersion?: string;
  template?: TemplateName;
}

export interface ScaffoldResult {
  targetDir: string;
  id: string;
  template: TemplateName;
  files: string[];
}

const DEFAULT_MIN_FRAMEWORK = "0.1.0";

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!MODULE_ID_RE.test(opts.id)) {
    throw new Error(
      `create-hebbs-module: invalid id "${opts.id}". Must match /^[a-z][a-z0-9-]*$/.`,
    );
  }
  const template = opts.template ?? "default";
  if (!TEMPLATES.includes(template)) {
    throw new Error(
      `create-hebbs-module: unknown template "${template}". One of: ${TEMPLATES.join(", ")}.`,
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
  const tableName = `${opts.id.replace(/-/g, "_")}__demo`;
  const factory = `create${pascal(opts.id)}Module`;
  const hasSchema = template === "default" || template === "data";

  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, "src"), { recursive: true });
  if (hasSchema) {
    await mkdir(join(targetDir, "src", "migrations"), { recursive: true });
  }
  await mkdir(join(targetDir, "src", "skills"), { recursive: true });

  const files: string[] = [];

  const ctx: RenderCtx = {
    template,
    id: opts.id,
    displayName,
    description,
    tableName,
    factory,
    minFrameworkVersion,
  };

  // module.json
  await writeFile(join(targetDir, "module.json"), renderManifestJson(ctx));
  files.push("module.json");

  // package.json
  await writeFile(join(targetDir, "package.json"), renderPackageJson(ctx));
  files.push("package.json");

  // tsconfig.json
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

  // src/module.ts
  await writeFile(join(targetDir, "src", "module.ts"), renderModuleSrc(ctx));
  files.push("src/module.ts");

  // src/index.ts
  await writeFile(
    join(targetDir, "src", "index.ts"),
    `export { ${factory}, default } from "./module.js";\n`,
  );
  files.push("src/index.ts");

  // src/skills/<id>.md
  await writeFile(
    join(targetDir, "src", "skills", `${opts.id}.md`),
    renderSkillMd(ctx),
  );
  files.push(`src/skills/${opts.id}.md`);

  // src/migrations/001-demo.sql (default + data only)
  if (hasSchema) {
    await writeFile(
      join(targetDir, "src", "migrations", "001-demo.sql"),
      renderMigrationSql(ctx),
    );
    files.push("src/migrations/001-demo.sql");
  }

  // README.md
  await writeFile(join(targetDir, "README.md"), renderReadme(ctx));
  files.push("README.md");

  // .gitignore
  await writeFile(
    join(targetDir, ".gitignore"),
    ["node_modules/", "dist/", ".data/", ""].join("\n"),
  );
  files.push(".gitignore");

  return { targetDir, id: opts.id, template, files };
}

// ───────────────────────────────────────────────────────────────────────────
// Template renderers
// ───────────────────────────────────────────────────────────────────────────

interface RenderCtx {
  template: TemplateName;
  id: string;
  displayName: string;
  description: string;
  tableName: string;
  factory: string;
  minFrameworkVersion: string;
}

function renderManifestJson(ctx: RenderCtx): string {
  return (
    JSON.stringify(
      {
        id: ctx.id,
        version: "0.1.0",
        kind: "module",
        name: ctx.displayName,
        description: ctx.description,
        entry: "./index.mjs",
        minFrameworkVersion: ctx.minFrameworkVersion,
        publisher: { id: "your-publisher-id", name: "Your Publisher" },
        license: "MIT",
        ...(ctx.template === "connector-consumer"
          ? {
              dependsOn: [
                { capability: "email-send", optional: true },
              ],
            }
          : {}),
      },
      null,
      2,
    ) + "\n"
  );
}

function renderPackageJson(ctx: RenderCtx): string {
  const deps: Record<string, string> = {
    "@boringos/module-sdk": "^0.10.0",
  };
  if (ctx.template === "connector-consumer") {
    deps["@boringos/connector-google"] = "^0.2.8";
  }
  return (
    JSON.stringify(
      {
        name: ctx.id,
        version: "0.1.0",
        private: true,
        type: "module",
        main: "./dist/index.js",
        scripts: {
          build: "tsc",
          test: "hebbs test .",
          typecheck: "tsc --noEmit",
        },
        dependencies: deps,
        devDependencies: {
          "@boringos/hebbs-cli": "^0.1.0",
          "@types/node": "^22.0.0",
          typescript: "^5.7.3",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function renderModuleSrc(ctx: RenderCtx): string {
  switch (ctx.template) {
    case "data":
      return renderDataModuleSrc(ctx);
    case "agent-only":
      return renderAgentOnlyModuleSrc(ctx);
    case "connector-consumer":
      return renderConnectorConsumerModuleSrc(ctx);
    case "default":
    default:
      return renderDefaultModuleSrc(ctx);
  }
}

function renderDefaultModuleSrc(ctx: RenderCtx): string {
  return (
    [
      `// ${ctx.displayName} — scaffolded by create-hebbs-module (default template).`,
      `//`,
      `// One-of-each surface (T5.2): a tool, a skill file ref, a demo`,
      `// schema migration, a seeded agent, a seeded workflow, and a`,
      `// cron routine. Trim anything you don't need.`,
      ``,
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { z } from "@boringos/module-sdk";`,
      `import type { Module, ModuleFactory, Migration } from "@boringos/module-sdk";`,
      ``,
      `const __moduleDir = dirname(fileURLToPath(import.meta.url));`,
      ``,
      `const demoMigration: Migration = {`,
      `  id: "${ctx.id}_demo_001",`,
      `  async up(db) {`,
      `    await db.execute(\`CREATE TABLE IF NOT EXISTS ${ctx.tableName} (`,
      `      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `      tenant_id uuid NOT NULL,`,
      `      note text NOT NULL,`,
      `      created_at timestamptz NOT NULL DEFAULT now())\`);`,
      `  },`,
      `  async down(db) {`,
      `    await db.execute(\`DROP TABLE IF EXISTS ${ctx.tableName}\`);`,
      `  },`,
      `};`,
      ``,
      `export const ${ctx.factory}: ModuleFactory = () => {`,
      `  const module: Module = {`,
      `    id: "${ctx.id}",`,
      `    name: ${JSON.stringify(ctx.displayName)},`,
      `    version: "0.1.0",`,
      `    description: ${JSON.stringify(ctx.description)},`,
      `    defaultInstall: false,`,
      `    skills: ["./skills/${ctx.id}.md"],`,
      `    tools: [{`,
      `      name: "greet",`,
      `      description: "Greet someone by name",`,
      `      inputs: z.object({ name: z.string() }),`,
      `      async handler({ name }: { name: string }) {`,
      `        return { ok: true as const, result: { greeting: \`Hello, \${name}!\` } };`,
      `      },`,
      `    }],`,
      `    schema: [demoMigration],`,
      `    agents: [{`,
      `      name: "${ctx.displayName} Concierge",`,
      `      persona: "personas-default.assistant",`,
      `      instructions: "Greet visitors and help with ${ctx.id} tasks.",`,
      `      tools: ["${ctx.id}.greet"],`,
      `    }],`,
      `    workflows: [{`,
      `      name: "${ctx.id}.daily_greet",`,
      `      description: "Greet a test user every day.",`,
      `      blocks: [{ id: "greet-1", kind: "tool", tool: "${ctx.id}.greet", inputs: { name: "Friend" } }],`,
      `      edges: [],`,
      `    }],`,
      `    routines: [{`,
      `      id: "${ctx.id}-daily-9am",`,
      `      title: "Daily greet at 9am UTC",`,
      `      trigger: { kind: "cron", cronExpression: "0 9 * * *", timezone: "UTC" },`,
      `      tool: "${ctx.id}.greet",`,
      `      inputs: { name: "Friend" },`,
      `    }],`,
      `    __moduleDir,`,
      `  };`,
      `  return module;`,
      `};`,
      ``,
      `export default ${ctx.factory};`,
      ``,
    ].join("\n")
  );
}

function renderDataModuleSrc(ctx: RenderCtx): string {
  return (
    [
      `// ${ctx.displayName} — scaffolded by create-hebbs-module (data template).`,
      `//`,
      `// Schema-heavy variant: two demo tables (${ctx.tableName} items + categories),`,
      `// CRUD tools, no seeded agents/workflows/routines.`,
      ``,
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { z } from "@boringos/module-sdk";`,
      `import type { Module, ModuleFactory, Migration } from "@boringos/module-sdk";`,
      ``,
      `const __moduleDir = dirname(fileURLToPath(import.meta.url));`,
      `const itemsTable = "${ctx.tableName}_items";`,
      `const categoriesTable = "${ctx.tableName}_categories";`,
      ``,
      `const schema: Migration[] = [`,
      `  {`,
      `    id: "${ctx.id}_categories",`,
      `    async up(db) {`,
      `      await db.execute(\`CREATE TABLE IF NOT EXISTS \${categoriesTable} (`,
      `        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `        tenant_id uuid NOT NULL,`,
      `        name text NOT NULL)\`);`,
      `    },`,
      `    async down(db) { await db.execute(\`DROP TABLE IF EXISTS \${categoriesTable}\`); },`,
      `  },`,
      `  {`,
      `    id: "${ctx.id}_items",`,
      `    async up(db) {`,
      `      await db.execute(\`CREATE TABLE IF NOT EXISTS \${itemsTable} (`,
      `        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `        tenant_id uuid NOT NULL,`,
      `        category_id uuid REFERENCES \${categoriesTable}(id),`,
      `        name text NOT NULL,`,
      `        created_at timestamptz NOT NULL DEFAULT now())\`);`,
      `    },`,
      `    async down(db) { await db.execute(\`DROP TABLE IF EXISTS \${itemsTable}\`); },`,
      `  },`,
      `];`,
      ``,
      `export const ${ctx.factory}: ModuleFactory = (deps) => {`,
      `  const db = deps.db as any;`,
      `  const module: Module = {`,
      `    id: "${ctx.id}",`,
      `    name: ${JSON.stringify(ctx.displayName)},`,
      `    version: "0.1.0",`,
      `    description: ${JSON.stringify(ctx.description)},`,
      `    defaultInstall: false,`,
      `    skills: ["./skills/${ctx.id}.md"],`,
      `    schema,`,
      `    tools: [`,
      `      {`,
      `        name: "items.create",`,
      `        description: "Create an item",`,
      `        inputs: z.object({ name: z.string(), categoryId: z.string().uuid().optional() }),`,
      `        async handler(input, ctx) {`,
      `          const rows = (await db.execute(\`INSERT INTO \${itemsTable}(tenant_id, name, category_id) VALUES (\${ctx.tenantId}::uuid, \${input.name}, \${input.categoryId ?? null}::uuid) RETURNING id\`)) as Array<{ id: string }>;`,
      `          return { ok: true as const, result: { id: rows[0]?.id } };`,
      `        },`,
      `      },`,
      `      {`,
      `        name: "items.list",`,
      `        description: "List items for the tenant",`,
      `        inputs: z.object({}),`,
      `        async handler(_input, ctx) {`,
      `          const rows = (await db.execute(\`SELECT id, name FROM \${itemsTable} WHERE tenant_id = \${ctx.tenantId}::uuid ORDER BY created_at DESC LIMIT 100\`)) as Array<{ id: string; name: string }>;`,
      `          return { ok: true as const, result: { items: rows } };`,
      `        },`,
      `      },`,
      `    ],`,
      `    __moduleDir,`,
      `  };`,
      `  return module;`,
      `};`,
      ``,
      `export default ${ctx.factory};`,
      ``,
    ].join("\n")
  );
}

function renderAgentOnlyModuleSrc(ctx: RenderCtx): string {
  return (
    [
      `// ${ctx.displayName} — scaffolded by create-hebbs-module (agent-only template).`,
      `//`,
      `// Agent-only variant: a seeded agent + SKILL, no tools, no schema.`,
      `// The agent reasons using framework primitives and other modules' tools.`,
      ``,
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import type { Module, ModuleFactory } from "@boringos/module-sdk";`,
      ``,
      `const __moduleDir = dirname(fileURLToPath(import.meta.url));`,
      ``,
      `export const ${ctx.factory}: ModuleFactory = () => {`,
      `  const module: Module = {`,
      `    id: "${ctx.id}",`,
      `    name: ${JSON.stringify(ctx.displayName)},`,
      `    version: "0.1.0",`,
      `    description: ${JSON.stringify(ctx.description)},`,
      `    defaultInstall: false,`,
      `    skills: ["./skills/${ctx.id}.md"],`,
      `    agents: [{`,
      `      name: "${ctx.displayName}",`,
      `      persona: "personas-default.assistant",`,
      `      instructions: ${JSON.stringify(`You are ${ctx.displayName}. Use your skill to handle requests.`)},`,
      `    }],`,
      `    __moduleDir,`,
      `  };`,
      `  return module;`,
      `};`,
      ``,
      `export default ${ctx.factory};`,
      ``,
    ].join("\n")
  );
}

function renderConnectorConsumerModuleSrc(ctx: RenderCtx): string {
  return (
    [
      `// ${ctx.displayName} — scaffolded by create-hebbs-module (connector-consumer template).`,
      `//`,
      `// Consumes the Google connector via deps.getConnectorToken(). Pair`,
      `// with @boringos/connector-google's typed GmailClient. Declares an`,
      `// optional "email-send" capability dep so the host can broker.`,
      ``,
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { z } from "@boringos/module-sdk";`,
      `import type { Module, ModuleFactory } from "@boringos/module-sdk";`,
      `import { GmailClient } from "@boringos/connector-google";`,
      ``,
      `const __moduleDir = dirname(fileURLToPath(import.meta.url));`,
      `const MODULE_ID = "${ctx.id}";`,
      ``,
      `export const ${ctx.factory}: ModuleFactory = (deps) => {`,
      `  const module: Module = {`,
      `    id: MODULE_ID,`,
      `    name: ${JSON.stringify(ctx.displayName)},`,
      `    version: "0.1.0",`,
      `    description: ${JSON.stringify(ctx.description)},`,
      `    defaultInstall: false,`,
      `    dependsOn: [{ capability: "email-send", optional: true }],`,
      `    skills: ["./skills/${ctx.id}.md"],`,
      `    tools: [{`,
      `      name: "inbox.list",`,
      `      description: "List the most recent Gmail messages for the tenant.",`,
      `      inputs: z.object({ maxResults: z.number().int().positive().max(50).optional() }),`,
      `      async handler({ maxResults }) {`,
      `        const handle = await deps.getConnectorToken?.("google", MODULE_ID);`,
      `        if (!handle) {`,
      `          return { ok: true as const, result: { messages: [], reason: "Google not connected" } };`,
      `        }`,
      `        const gmail = new GmailClient(handle.getToken);`,
      `        const messages = await gmail.listMessages({ maxResults: maxResults ?? 10 });`,
      `        return { ok: true as const, result: { messages } };`,
      `      },`,
      `    }],`,
      `    __moduleDir,`,
      `  };`,
      `  return module;`,
      `};`,
      ``,
      `export default ${ctx.factory};`,
      ``,
    ].join("\n")
  );
}

function renderSkillMd(ctx: RenderCtx): string {
  switch (ctx.template) {
    case "data":
      return [
        `# ${ctx.displayName}`,
        ``,
        `\`${ctx.id}\` owns two tenant-scoped tables: items + categories.`,
        ``,
        `Tools:`,
        `- \`${ctx.id}.items.create({ name, categoryId? })\` — creates an item.`,
        `- \`${ctx.id}.items.list({})\` — returns the 100 newest items for the tenant.`,
        ``,
      ].join("\n");
    case "agent-only":
      return [
        `# ${ctx.displayName}`,
        ``,
        `You are ${ctx.displayName}. You don't own any tools yourself — you`,
        `reason using the framework's general tools and other modules' tools.`,
        `Be concise; ask the user a clarifying question if intent is ambiguous.`,
        ``,
      ].join("\n");
    case "connector-consumer":
      return [
        `# ${ctx.displayName}`,
        ``,
        `\`${ctx.id}.inbox.list\` returns the tenant's most recent Gmail messages.`,
        `Requires the Google connector to be connected — otherwise returns an`,
        `empty list with \`reason: "Google not connected"\`.`,
        ``,
      ].join("\n");
    case "default":
    default:
      return [
        `# ${ctx.displayName}`,
        ``,
        `Use \`${ctx.id}.greet\` to greet someone by name. Pass`,
        `\`{ name: string }\` — returns \`{ greeting: string }\`.`,
        ``,
        `Examples:`,
        `- A user shared their name in copilot; reply with a personalised greeting.`,
        `- A workflow needs to acknowledge an inbound lead.`,
        ``,
      ].join("\n");
  }
}

function renderMigrationSql(ctx: RenderCtx): string {
  if (ctx.template === "data") {
    return [
      `-- ${ctx.displayName} demo tables.`,
      `--`,
      `-- Mirror of Module.schema in src/module.ts.`,
      ``,
      `CREATE TABLE IF NOT EXISTS ${ctx.tableName}_categories (`,
      `  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `  tenant_id uuid NOT NULL,`,
      `  name text NOT NULL`,
      `);`,
      ``,
      `CREATE TABLE IF NOT EXISTS ${ctx.tableName}_items (`,
      `  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `  tenant_id uuid NOT NULL,`,
      `  category_id uuid REFERENCES ${ctx.tableName}_categories(id),`,
      `  name text NOT NULL,`,
      `  created_at timestamptz NOT NULL DEFAULT now()`,
      `);`,
      ``,
    ].join("\n");
  }
  return [
    `-- ${ctx.displayName} demo table.`,
    `--`,
    `-- Mirror of the migration shipped via Module.schema in src/module.ts.`,
    `-- The framework runs the TS version at install time.`,
    ``,
    `CREATE TABLE IF NOT EXISTS ${ctx.tableName} (`,
    `  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
    `  tenant_id uuid NOT NULL,`,
    `  note text NOT NULL,`,
    `  created_at timestamptz NOT NULL DEFAULT now()`,
    `);`,
    ``,
  ].join("\n");
}

function renderReadme(ctx: RenderCtx): string {
  return [
    `# ${ctx.displayName}`,
    ``,
    `${ctx.description}`,
    ``,
    `**Template:** \`${ctx.template}\``,
    ``,
    `## Develop`,
    ``,
    "```bash",
    `pnpm install`,
    `pnpm build`,
    `pnpm test    # boots a headless host and verifies install`,
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
  ].join("\n");
}

function pascal(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
