# @boringos/db

Database schema and connection management for BoringOS. Drizzle ORM with Postgres. External Postgres is the production path; embedded Postgres ships as a zero-config dev fallback.

## Install

```bash
npm install @boringos/db
```

## Usage

### External Postgres (production)

Set `DATABASE_URL` and BoringOS picks it up automatically at boot. You can also pass it explicitly:

```typescript
import { createDatabase, createMigrationManager } from "@boringos/db";

const { db, close } = await createDatabase({
  url: process.env.DATABASE_URL!,
});

const migrator = createMigrationManager(db);
await migrator.apply();
```

The database must already exist. BoringOS does not create it. Run this once:

```bash
psql -c "CREATE DATABASE boringos;" postgres://user:pass@host:5432/postgres
```

### Embedded Postgres (dev only)

Zero-config, data stored in `.data/postgres`. Starts automatically when no `DATABASE_URL` is set.

```typescript
const { db, close } = await createDatabase({ embedded: true });
```

### Use Drizzle ORM directly

```typescript
import { agents, tasks } from "@boringos/db";
const allAgents = await db.select().from(agents);
await close();
```

## Connection poolers (Supabase, pgBouncer in transaction mode)

Add `prepare: false` to your connection string or pass it via the `postgres()` options. Transaction-mode poolers do not support prepared statements.

```
postgres://user:pass@host:5432/db?prepare=false
```

## Postgres version

Postgres 15 or newer is required (`gen_random_uuid()` is a built-in).

## API Reference

### Connection

| Export | Description |
|---|---|
| `createDatabase(config)` | Connect to external Postgres or start embedded dev instance |
| `createMigrationManager(db)` | Schema bootstrap via idempotent DDL |

### Schema tables

`tenants`, `agents`, `tasks`, `taskComments`, `agentRuns`, `agentWakeupRequests`, `runtimes`, `costEvents`, `workflows`, `connectors`, `driveFiles`, `activityLog`, `budgetPolicies`, `budgetIncidents`, `routines`, `onboardingState`

All tables include `tenantId` for multi-tenant scoping.

### Types

`DatabaseConfig`, `MigrationManager`, `Db`, `DatabaseConnection`, `FrameworkTable`

### Constants

`FRAMEWORK_TABLES` -- list of all table names

## Encrypting existing OAuth credentials

After deploying the encryption change (Task 0.2 in the Connector SDK v2 effort), run this script once per environment to encrypt any rows that still hold plaintext credentials from before the deployment.

```bash
BORINGOS_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
  pnpm --filter @boringos/db tsx scripts/encrypt-existing-credentials.ts
```

The script is **idempotent**: rows already encrypted (string value in `credentials`) are skipped. Rows with NULL credentials are also skipped. Safe to re-run.

**Generating an encryption key:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the resulting 64-character hex string in your secret manager as `BORINGOS_ENCRYPTION_KEY`. Losing this key means losing access to all connector credentials. There is no recovery path.

**Rollback:** restore the connectors table from backup. (The encryption is one-way for any individual row, but the row's stored value is fully replaced. No in-place mutation, so a backup restore is clean.)

## Connector SDK v2 migration ordering

Upgrading an existing deployment from pre-v2 (plaintext `connectors` table) to v2 (encrypted `connector_accounts`) requires running two scripts in sequence:

1. **Encrypt the legacy plaintext rows** with `scripts/encrypt-existing-credentials.ts` (documented above). This converts the `connectors.credentials` JSONB column from plaintext objects to encrypted strings in-place. The application code reads either shape during this window.

2. **Copy rows to `connector_accounts`** with `scripts/migrate-connectors-to-accounts.ts`. This reads from the now-encrypted `connectors` table and inserts into the new multi-account schema. Both scripts are idempotent.

```bash
# Step 1
BORINGOS_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
  pnpm --filter @boringos/db tsx scripts/encrypt-existing-credentials.ts

# Step 2
BORINGOS_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
  pnpm --filter @boringos/db tsx scripts/migrate-connectors-to-accounts.ts
```

After step 2 succeeds, the `connectors` table can be dropped (the v2 schema apply already does this via `DROP TABLE IF EXISTS connectors CASCADE`).

**For fresh deployments** (no pre-v2 data): both scripts are no-ops and can be skipped. The schema apply creates the new tables directly.

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)
