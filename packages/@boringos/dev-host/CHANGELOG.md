# @boringos/dev-host

## 0.2.0

### Minor Changes

- 94e73b7: New package `@boringos/dev-host` — a reusable headless harness that boots BoringOS with all built-ins, registers a `.hebbsmod` (or a pre-built module package), seeds a tenant, mints a callback JWT, and exposes a `dispatch(toolName, inputs)` helper plus direct DB access for assertions. The single `createDevHost({ modulePath })` call replaces the bespoke `scripts/try-runtime-install.mjs` orchestration — future `hebbs test` and CI acceptance scripts consume this entrypoint. MDK T4.1.
