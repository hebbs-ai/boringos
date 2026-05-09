# Build a Module — v2 quickstart

> **Status:** Working starter. For canonical field-by-field
> reference see [`MODULES.md`](MODULES.md), [`TOOLS.md`](TOOLS.md),
> and [`SKILLS.md`](SKILLS.md). This file is the practical
> minimum: what works on `branch_modules_skills` today.

This file teaches you to write a v2 Module — the universal
component shape that replaces v1's connector / app / plugin
trio. A Module is a manifest of skills + tools the agent can
read and call. The framework wires the rest.

---

## What you need

- TypeScript / Node 22+
- `pnpm install` at the repo root
- Be on `branch_modules_skills` (v2 lives there until cutover)

---

## The minimal Module

A Module manifest is a plain object. Here's the smallest possible
one:

```typescript
import { z } from "@boringos/module-sdk";
import type { Module } from "@boringos/module-sdk";

export const helloModule: Module = {
  id: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "Demo module — one tool, one skill",

  skills: [
    {
      id: "hello",
      source: "module",
      body: "Use `hello.greet` to greet someone by name. " +
            "It's a no-op example — useful for verifying " +
            "your prompt sees v2 modules.",
    },
  ],

  tools: [
    {
      name: "greet",
      description: "Greet someone by name",
      inputs: z.object({ name: z.string() }),
      async handler({ name }) {
        return { ok: true, result: { greeting: `hello, ${name}` } };
      },
    },
  ],
};
```

Register it on a BoringOS host:

```typescript
import { BoringOS } from "@boringos/core";
import { helloModule } from "./hello-module.js";

const app = new BoringOS({});
app.module(helloModule);
await app.listen(3000);
```

That's it. The agent's prompt now includes:

- A `## Skills` section with the `### hello` block
- A `## Available tools` section listing `hello.greet`

The agent can call it with:

```bash
curl -X POST http://localhost:3000/api/tools/hello.greet \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "world"}'

# {"ok": true, "result": {"greeting": "hello, world"}}
```

---

## When to use a `ModuleFactory` instead

The inline form above works when your Module doesn't need access
to framework services (DB, memory provider, etc.). When you do,
pass a factory function instead — the framework calls it after
boot with the deps:

```typescript
import type { ModuleFactory } from "@boringos/module-sdk";
import type { Db } from "@boringos/db";

export const myCrmModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;

  return {
    id: "my-crm",
    name: "My CRM",
    version: "0.1.0",
    description: "...",
    tools: [
      {
        name: "list_deals",
        description: "List all deals for the tenant",
        inputs: z.object({}),
        async handler(_input, ctx) {
          const rows = await db
            .select()
            .from(/* your schema */)
            .where(/* tenantId = ctx.tenantId */);
          return { ok: true, result: { deals: rows } };
        },
      },
    ],
  };
};

// Register it the same way:
app.module(myCrmModule);
```

`ModuleFactoryDeps` exposes `db`, `memory`, `drive`, `engine`,
`workflowEngine`. Cast to your concrete types.

---

## Anatomy of a Tool

```typescript
{
  name: "create_deal",            // local name; full URL becomes <module>.create_deal
  description: "Create a deal",   // shown to the agent in the catalog
  inputs: z.object({              // Zod schema — validated before handler runs
    contactId: z.string().uuid(),
    amount: z.number().positive(),
    stage: z.enum(["new", "qualified", "won", "lost"]).optional(),
  }),
  output: z.object({              // optional — output schema for return values
    dealId: z.string(),
  }),
  async handler(input, ctx) {     // input is z.infer<typeof inputs>; ctx is ToolContext
    // ctx.tenantId, ctx.agentId, ctx.runId, ctx.taskId, ctx.invokedBy

    if (/* business rule fails */) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: "Contact does not exist",
          retryable: false,
        },
      };
    }

    const dealId = await /* do the work */;
    return { ok: true, result: { dealId } };
  },
}
```

### Error model

Tools return either `{ ok: true, result }` or `{ ok: false, error }`.

`error.code` is one of:
- `invalid_input` — schema validation failed (the framework returns this automatically when Zod rejects)
- `not_found` — referenced entity doesn't exist
- `permission_denied` — caller can't do this
- `upstream_unavailable` — 3rd-party API is down or misbehaving
- `rate_limited` — caller exceeded a quota
- `conflict` — concurrent write conflict
- `internal` — handler threw an uncaught error (the framework converts these and returns 500)

`error.retryable` tells the agent whether to retry. The framework
SKILL teaches the agent the retry policy.

### What the dispatcher does for you

Before your handler runs:
- Verifies the JWT (agent calls only — internal callers skip this)
- Looks up the tool by full name; 404 if missing
- Validates inputs against your Zod schema; 400 if invalid

After your handler returns:
- Wraps the result in the right HTTP status (200 for ok or business error, 500 for thrown)
- Writes a `tool_calls` audit row (tenant, tool, inputs, result, duration, status)

You write business logic. The framework handles the rest.

---

## Anatomy of a Skill

A Skill is markdown injected into the agent's prompt. Today they
live as inline `Skill` objects on the Module manifest. In Phase 6+
they move to literal `SKILL.md` files in your package, with
frontmatter for metadata.

```typescript
{
  id: "crm",                      // unique within the module
  source: "module",               // how it was loaded — "module" for in-package
  body: `Use the CRM tools to ... [markdown content]`,
  priority: 100,                  // ordering in the prompt; lower = earlier
  appliesTo: (event) =>           // optional gating
    event.agentRole === "sales-rep",
  requires: ["crm.list_deals"],   // (future) flag drift if this tool is missing
}
```

Priority ranges:
- `50` — framework-level (tool-protocol, approvals, when-stuck)
- `60-90` — module-shipped skills
- `200+` — agent persona / instructions
- `400` — tenant override

Lower priority appears EARLIER in the prompt. Higher priority
appears closer to the task — more influence on agent behavior.

---

## Testing your Module

```typescript
import { describe, it, expect } from "vitest";
import { createToolRegistry, dispatch } from "@boringos/agent";
import { z } from "@boringos/module-sdk";
import { helloModule } from "./hello-module.js";

describe("hello module", () => {
  it("greets via the dispatcher", async () => {
    const tools = createToolRegistry();
    for (const tool of helloModule.tools ?? []) {
      tools.register(helloModule.id, tool);
    }

    const out = await dispatch(
      { registry: tools },
      "hello.greet",
      { name: "world" },
      {
        tenantId: "t1",
        agentId: "a1",
        runId: "r1",
        invokedBy: "agent",
      },
    );

    expect(out.status).toBe(200);
    expect(out.result.ok).toBe(true);
    expect(out.result.result.greeting).toBe("hello, world");
  });
});
```

For HTTP-level testing, see the existing patterns in
`tests/v2-http.test.ts` and `tests/v2-framework-module.test.ts`.

---

## What's NOT in this starter

The full Module manifest supports much more than what's shown
above. Below is the eight-dimensional surface — items marked with
🔜 ship in later phases of `task_12`:

| Field | Status |
|---|---|
| `skills` | ✅ inline; 🔜 SKILL.md files in Phase 6 |
| `tools` | ✅ |
| `dependsOn` / `provides` | 🔜 Phase 9 (capability resolution) |
| `schema` (Drizzle migrations, prefixed `<id>__`) | 🔜 Phase 8 (CRM port) |
| `ui` (screens, panels, settings) | 🔜 Phase 10 |
| `workflows` (default seeded) | 🔜 Phase 9 |
| `agents` (default seeded) | 🔜 Phase 9 |
| `routines` (cron / event / webhook) | 🔜 Phase 9 |
| `webhooks` (inbound HTTP) | 🔜 Phase 7 connector polish |
| `oauth` | 🔜 Phase 7 connector polish |
| `lifecycle.{onInstall, onUninstall, onTenantCreate}` | 🔜 Phase 5 polish |

---

## Next steps after this guide

1. Read [`docs/blockers/task_12_greenfield_rebuild.md`](docs/blockers/task_12_greenfield_rebuild.md)
   end-to-end if you'll be authoring or porting Modules.
2. Look at `packages/@boringos/core/src/v2-modules/framework.ts`
   for a complete real Module — 9 tools, 3 skills, full DB
   integration.
3. The other built-ins (`memory.ts`, `drive.ts`, `workflow.ts`,
   `inbox.ts`) are tighter examples of single-purpose modules.
4. The CRM port (`task_12` Phase 8) will be the first hybrid
   Module exercising every dimension — schema, UI, default
   workflows, default agents. That's the canonical guide
   `task_13` rewrites this file around.
