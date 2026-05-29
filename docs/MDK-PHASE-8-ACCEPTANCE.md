# MDK Phase 8 — Acceptance summary

**Date:** 2026-05-29
**Status:** Accepted. All gates live.

The MDK plan (Phase 8 / T8.7) asks: "CRM fully off published SDK,
E2E gate live in both repo's CI. No `link:` deps anywhere in CRM."
This doc records the per-criterion verification.

## 1. CRM consumes published `@boringos/*` only

`hebbs-ai/hebbs-crm` at `afe3da4`:

```
@boringos/agent          ^0.3.1
@boringos/module-sdk     ^0.13.0
@boringos/connector-google ^0.2.8
@boringos/connector-slack  ^0.2.8
@boringos/core           ^0.4.0
@boringos/db             ^0.2.0
@boringos/shared         ^0.1.8
```

Verified: `grep '"link:\|"workspace:\|"file:' packages/*/package.json`
returns **only** intra-CRM workspace refs (`@boringos-crm/shared`),
which are correct — those are the CRM's own monorepo packages, not
framework deps. Zero `link:` or `file:` anywhere.

## 2. Framework E2E gate

`hebbs-ai/boringos@8d494e5` ships
`tests/crm-e2e-hebbs-test.test.ts` — a Vitest test that drives
`runTest` from `@boringos/hebbs-cli` against the packed
`crm-0.3.0.hebbsmod`. The gate covers:

- Module registration + install on a fresh embedded host
- `crm.contacts.create` dispatch + row write
- `crm.calendar.sync_prep` soft-no-op (Connector SDK v2 path)

`scripts/try-runtime-install.mjs` was deleted in the same commit —
the Vitest test is the only path.

## 3. Cross-repo CI workflows

Both repos run an MDK Acceptance workflow on PR + push to main:

- `hebbs-ai/boringos`: `.github/workflows/mdk-acceptance.yml` —
  full `pnpm -r typecheck && pnpm -r build && pnpm test:run` (the
  CRM E2E above is part of `pnpm test:run`).
- `hebbs-ai/hebbs-crm`: `.github/workflows/mdk-acceptance.yml` —
  installs from `pnpm-lock.yaml` (frozen, resolves against published
  `@boringos/*`), then `pnpm -r typecheck && pnpm -r build &&
  pnpm test:run`. If a framework release breaks downstream, this
  goes red on the next CRM PR.

No additional secrets required beyond the existing `NPM_TOKEN`
already in place for the Release workflow.

## 4. Carry-overs (intentional)

- **CRM workflows + routines** still seed via raw SQL (not
  `Lifecycle.seed`). They reference agent ids the current
  `SeedResult` doesn't expose; lifting that is a small follow-up
  on top of T7.1 / T8.3.
- **CRM `Lifecycle.seed` cleanup**: `scrubCrmSeeds` was trimmed
  (workflows + routines path stays; agent cascade dropped via
  `keepAgents: true`). Full retirement rides on the workflow/routine
  migration above.
- **Slack live-bot-token shortcut** removed (was dead v1 code).
  Slack OAuth flows the v2 connector path via AuthManager.

## 5. Where the gate lives going forward

If a downstream contract changes (CRM tools / install flow / 7-slot
PluginUI), the breakage surfaces in:

1. Framework PR → `tests/crm-e2e-hebbs-test.test.ts` fails locally.
2. Framework push to main → `MDK Acceptance` workflow goes red.
3. After framework release publishes a new minor → CRM's
   `MDK Acceptance` workflow on the next CRM PR catches any incompat.

Phase 8 acceptance: **closed**. Moving on to Phase 9 governance.
