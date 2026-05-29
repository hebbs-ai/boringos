---
"@boringos/agent": minor
---

`__seed_meta` cleanup on uninstall + dangling-target recovery (MDK T8.3).

- `installManager.uninstall()` now deletes `__seed_meta` rows for the (tenant, module) pair before dropping the install row. Without this, a subsequent re-install saw stale meta with dangling `target_id` and skipped re-seeding rows the uninstall just cleared.
- `runSeed` now handles the dangling-target branch by dropping the stale meta row and falling through to first-time-seed semantics. Covers the CRM-style `scrubCrmSeeds` pattern where rows get cleared but meta needs to be regenerated.
