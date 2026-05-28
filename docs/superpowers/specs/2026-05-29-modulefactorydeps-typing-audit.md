# `ModuleFactoryDeps` typing audit — Phase 3 prep

**Status:** Audit (informational). Implementation is **MDK Phase 3 / T3.1** in `plans/module-dev-kit.md`.
**Date:** 2026-05-29.
**Owner:** @parag (MDK loop).
**Closes:** the audit deliverable for **T0.4** of the MDK plan.

## Why this audit

`ModuleFactoryDeps` (in `packages/@boringos/module-sdk/src/types.ts`) is the typed half of the **host → module** contract. Today 8 of its 11 fields are typed as `unknown`. Every module casts them at use site (e.g. `factoryDeps.db as PostgresJsDatabase`), which means:

- TypeScript cannot catch a host that forgets to inject `eventBus`.
- Module authors must learn the concrete type from another package's source.
- The "no `as unknown as`" quality gate in the MDK loop is unenforceable until the source surface stops requiring casts.

**#60 (Connector SDK v2)** already typed the connector slice — `getConnectorToken`, `listConnectedAccounts`, `checkScopes`. The remaining 8 fields are the question this audit answers: which type now, which leave, and why.

## The 11 fields, one by one

| Field | Current type | Concrete type / location | Cycle? | **Recommendation** |
|---|---|---|---|---|
| `db` | `unknown` | `PostgresJsDatabase` (drizzle-orm/postgres-js, 3rd-party) — also exported as `Db` from `@boringos/db` | n/a | **Keep `unknown`** — see §"db" below. The SDK is deliberately Drizzle-free; adopting drizzle as an SDK dep is a policy decision that belongs outside T3.1. |
| `memory` | `unknown` | `MemoryProvider` in `@boringos/memory/src/types.ts` (extends `SkillProvider` from `@boringos/shared`) | **No** — `memory` only depends on `shared` | **Type now** as `MemoryProvider \| undefined`. Add `@boringos/memory` to module-sdk peer deps. |
| `drive` | `unknown` | `StorageBackend` in `@boringos/drive/src/types.ts` (extends `SkillProvider`) | **No** — `drive` depends on `shared` + `db`, not module-sdk | **Type now** as `StorageBackend \| undefined`. Add `@boringos/drive` to module-sdk peer deps. |
| `engine` | `unknown` | `AgentEngine` in `@boringos/agent/src/types.ts` | **Yes** — `agent` imports module-sdk | **Keep `unknown`** for now. See §"engine / workflowEngine" — large, unstable surface; modules rarely call it directly; pinning the type here ossifies an internal contract. |
| `workflowEngine` | `unknown` | `WorkflowEngine` in `@boringos/core` (actual definition tied to workflow module) | **Yes** — `core` imports module-sdk | **Keep `unknown`**. Same rationale as `engine`. |
| `toolRegistry` | `unknown` | `ToolRegistry` in `@boringos/agent/src/registries/tool-registry.ts` | **Yes** — `agent` imports module-sdk | **Extract a minimal `ToolRegistry` interface** to module-sdk, type the field with it. Surface a module actually uses is small (`invoke`, `list`). The big version stays in `@boringos/agent` and implements the SDK interface. |
| `realtimeBus` | `unknown` | `RealtimeBus` in `@boringos/core/src/realtime.ts` — exposes `.publish(...)`. (Note: the SDK doc comment says "`emit`" — actual method is `publish`. Drift to fix while we're here.) | **Yes** — `core` imports module-sdk | **Extract a minimal `RealtimeBus` interface** to module-sdk; type the field with it. The single method modules call is `publish`. Fix the SDK doc comment from `emit` → `publish` in the same change. |
| `eventBus` | `unknown` | `EventBus` in `@boringos/core/src/event-bus.ts` | **Yes** — `core` imports module-sdk | **Extract a minimal `EventBus` interface** to module-sdk; type the field with it. CRM already maintains a shim (`CrmEventBus` in `boringos-crm/.../tools/deps.ts`) covering exactly the methods modules actually use — that shape is a good starting point for the SDK interface. |
| `getConnectorToken` | typed (`#60`) | `ConnectorTokenHandle \| null` | — | Already done. |
| `listConnectedAccounts` | typed (`#60`) | `Promise<ConnectedAccount[]>` | — | Already done. |
| `checkScopes` | typed (`#60`) | `Promise<ScopeCheckResult>` | — | Already done. |

## Recommended Phase 3 / T3.1 task breakdown

Split T3.1 into 4 sub-PRs (single-commit each, per the MDK loop direct-to-`main` convention):

1. **T3.1a — type `memory` + `drive`.** Pure additive; add the two peer deps to module-sdk; update `ModuleUsing` comments. **No cycle, no extracted interfaces — smallest unblock.**
2. **T3.1b — extract `RealtimeBus` interface to module-sdk + type the field.** Fix the `emit` / `publish` doc-comment drift in the same change. Concrete `@boringos/core` class now `implements` the SDK interface.
3. **T3.1c — extract `EventBus` interface to module-sdk + type the field.** Use CRM's `CrmEventBus` shape as the starting point (it's the in-use surface).
4. **T3.1d — extract minimal `ToolRegistry` interface to module-sdk + type the field.** Module-facing surface is `invoke(toolName, inputs, ctx?)` + `list(): ToolMeta[]`; the agent's full registry implements it.

Each sub-PR keeps the changeset on `@boringos/module-sdk` minor (additive types) and `@boringos/core` / `@boringos/agent` patch (no behavior change).

## Ambiguities — open for discussion

These are the things this audit *does not* unilaterally decide. Surface them on `#50` before doing T3.1:

1. **Should the SDK take a drizzle peer dep so `db` can be typed as `PostgresJsDatabase`?** Trade-off:
   - **Pro:** every module already casts to it; the SDK type would just reflect reality.
   - **Con:** locks the SDK to drizzle as the ORM choice. If we ever switch (e.g. prisma, kysely), the SDK breaks all consumers.
   - **Alternative:** define a `BoringDb` interface in module-sdk exposing only what modules need (`select`, `insert`, `update`, `delete`, `execute`) and have `@boringos/db`'s drizzle wrapper implement it. Larger refactor; right long-term but doesn't have to land in Phase 3.
   - **Provisional recommendation:** keep `unknown` for now; revisit when there's a second ORM (or a Phase 7 SDK polish pass).

2. **Should `engine` and `workflowEngine` ever be typed in module-sdk?** They're internal orchestration. Modules can register tools / agents / workflows declaratively; the engine doesn't need to leak. Recommend documenting them as `@internal — host-side use only` in the SDK doc comments and keeping them `unknown` indefinitely.

3. **Should we also export *concrete* type aliases from the SDK** so module authors can write `const bus: EventBus = factoryDeps.eventBus!;` without an extra import? Yes — every typed field gets a re-export from `@boringos/module-sdk/index.ts`. Folds naturally into each sub-PR.

## Verification path (for T3.1 PRs)

After each sub-PR:

- CRM's `boringos-crm/packages/server/` source contains **zero new** `as unknown as` casts (audit with `rg "as unknown as"`).
- `pnpm -r typecheck` still green.
- The framework's existing tests pass without modification (the runtime shape is unchanged; only TypeScript types tighten).

## Closes

- **MDK Plan T0.4** — "Decide which `ModuleFactoryDeps.unknown` fields to type now; list any still ambiguous." (this doc)
- Unblocks **T3.1** (Phase 3 typing) with a concrete task ladder.

---

### Appendix — quick code references

- Current `ModuleFactoryDeps`: `packages/@boringos/module-sdk/src/types.ts`
- `MemoryProvider`: `packages/@boringos/memory/src/types.ts:5`
- `StorageBackend`: `packages/@boringos/drive/src/types.ts:5`
- `SkillProvider` (base of the two above): `packages/@boringos/shared/src/types.ts:216`
- `AgentEngine`: `packages/@boringos/agent/src/types.ts:12`
- `ToolRegistry`: `packages/@boringos/agent/src/registries/tool-registry.ts:21`
- `RealtimeBus`: `packages/@boringos/core/src/realtime.ts:52`
- `EventBus`: `packages/@boringos/core/src/event-bus.ts:19`
- Existing in-tree shim for the `EventBus` shape modules actually use: `boringos-crm/packages/server/src/tools/deps.ts` (`CrmEventBus`).
