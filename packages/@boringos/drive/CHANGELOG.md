# @boringos/drive

## 0.1.10

### Patch Changes

- Updated dependencies [d1695e0]
  - @boringos/db@0.2.0

## 0.1.9

### Patch Changes

- Republish baseline — closes the T1.4 blocker. Fixes two upstream publish bugs from the `b0897a8` chore release:

  1. Six packages (`db`, `runtime`, `ui`, `memory`, `drive`, `pipeline`) had unresolved `workspace:*` references in their published `0.1.8` tarballs' dependency lists. Republishing via `pnpm changeset publish` correctly converts those to concrete versions.
  2. `@boringos/ui@0.1.8` source contained `PluginUI` (the canonical UI contract type from Connector SDK v2) but the previously published tarball did not include the export. The patch republish ships it.

  No source-level API changes; this is purely a registry-hygiene catch-up so downstream modules (CRM) can install from npm cleanly.

- Updated dependencies
  - @boringos/db@0.1.9

## 0.1.1

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1
  - @boringos/db@0.1.2

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
  - @boringos/db@0.1.0
