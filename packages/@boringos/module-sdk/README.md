# @boringos/module-sdk

Public type surface for v2 Modules. Every connector, capability,
hybrid app, and built-in subsystem in v2 is shaped as a `Module`
declared with these types.

## What's in this package

- `Module` — the universal manifest shape
- `Tool`, `ToolContext`, `ToolResult`, `ToolError` — callable
  operations
- `Skill`, `SkillSource`, `SkillApplicabilityEvent` — markdown
  teaching loaded into the agent's prompt
- `Routine`, `RoutineTrigger` — scheduled tool calls
- `Webhook`, `WebhookRequest` — inbound HTTP
- `OAuthConfig` — connector OAuth dance
- `Migration`, `ModuleDb` — Module-owned DDL
- `ModuleUI`, `ScreenDef`, `PanelDef` — browser-facing surface
- `ModuleLifecycle`, `ModuleContext` — install / uninstall hooks
- `ModuleFactory`, `ModuleFactoryDeps` — factory shape for
  service-aware Modules
- `WorkflowSeed`, `WorkflowBlock`, `WorkflowEdge` — default
  workflows seeded on install
- `AgentSeed` — default agents seeded on install
- `z` — re-export of Zod for input/output schemas

This package exports **types only** (plus the Zod re-export).
Registries, dispatch, and prompt assembly live in
`@boringos/agent` and `@boringos/core`.

## Conventions third-party authors must follow

The types here permit many shapes; the framework's runtime expects
some choices to be made consistently so every module composes with
the Shell, Copilot, workflow templating (`{{blockName.field}}`),
and other modules' tools.

- **Tool result payload shape.** Successful results follow a
  single rule: list-style tools return a named-key object keyed
  by the plural resource (`{ result: { messages } }`,
  `{ result: { events } }`, `{ result: { deals } }`); singular
  tools return the value directly (`{ result: message }`). See
  [`TOOLS.md` → Result payload convention](../../../TOOLS.md#result-payload-convention)
  for the full rule and rationale.
- **Error shape.** Expected failures always return
  `{ ok: false, error: ToolError }`; unhandled bugs throw and the
  dispatcher converts to `code: "internal"`. See `ToolError` /
  `ToolErrorCode` above.
- **`tenantId` is in `ToolContext`, never in inputs.** Handlers
  read it from context for DB scoping and audit; clients can't
  forge it.

## Imported by

Every v2 Module — built-in (`@boringos/core/src/v2-modules/*`)
and third-party.

## Minimal usage

```ts
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
      body: "Use `hello.greet` to say hi to someone by name.",
    },
  ],

  tools: [
    {
      name: "greet",
      description: "Greet someone by name",
      inputs: z.object({ name: z.string() }),
      async handler({ name }) {
        return { ok: true, result: { message: `Hello, ${name}!` } };
      },
    },
  ],
};
```

Register it on the host:

```ts
import { BoringOS } from "@boringos/core";
import { helloModule } from "./hello.js";

const app = new BoringOS({ /* config */ });
app.module(helloModule);
await app.listen(3000);
```

## See also

- [`MODULES.md`](../../../MODULES.md) — full Module spec
- [`TOOLS.md`](../../../TOOLS.md) — Tool spec, error model, audit
- [`SKILLS.md`](../../../SKILLS.md) — Skill spec, priorities,
  overrides
- [`BUILD-A-MODULE.md`](../../../BUILD-A-MODULE.md) — step-by-step
  guide
