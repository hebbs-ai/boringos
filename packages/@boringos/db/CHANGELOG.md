# @boringos/db

## 0.2.0

### Minor Changes

- d1695e0: Seed upgrade policy via `__seed_meta` + content hashes (MDK T7.2).

  - `@boringos/db` — new `__seed_meta` table (and Drizzle export) tracking every framework-seeded agent / workflow / routine per tenant. Columns: `tenant_id`, `module_id`, `kind`, `seed_id`, `target_id`, `baseline_hash`, `module_version`. Unique on `(tenant_id, module_id, kind, seed_id)`; secondary index on `target_id` for reverse lookups.
  - `@boringos/module-sdk` — `AgentSeed`, `WorkflowSeed`, and `Routine` gain optional `seedId` (defaults to name / title / id) so authors can rename a seed without losing the upgrade thread.
  - `@boringos/agent` — `runSeed` now compares the current row's canonical-JSON hash against `__seed_meta.baseline_hash` to decide what to do on re-install:
    - Hash matches baseline AND payload changed → update the row + bump the meta.
    - Hash matches baseline AND payload unchanged → skip (no churn).
    - Hash differs from baseline → tenant edited; skip and leave their edit alone.
  - The "modified_since_install" check is implicit: no extra column on the seed target. The framework compares hashes at re-install time, so tenant edits via any path (admin API, manual SQL, future tools) are honoured without the framework having to remember to set a flag.

  Acceptance test (`tests/seed-upgrade-policy.test.ts`): tenant edits a routine, author bumps the seed, the tenant's edit survives. Companion test: untouched routine gets upgraded.

## 0.1.9

### Patch Changes

- Republish baseline — closes the T1.4 blocker. Fixes two upstream publish bugs from the `b0897a8` chore release:

  1. Six packages (`db`, `runtime`, `ui`, `memory`, `drive`, `pipeline`) had unresolved `workspace:*` references in their published `0.1.8` tarballs' dependency lists. Republishing via `pnpm changeset publish` correctly converts those to concrete versions.
  2. `@boringos/ui@0.1.8` source contained `PluginUI` (the canonical UI contract type from Connector SDK v2) but the previously published tarball did not include the export. The patch republish ships it.

  No source-level API changes; this is purely a registry-hygiene catch-up so downstream modules (CRM) can install from npm cleanly.

## 0.1.2

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
