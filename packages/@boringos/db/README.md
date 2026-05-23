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

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)
