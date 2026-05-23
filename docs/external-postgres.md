# External Postgres — operator guide

This document covers running BoringOS against an external (persistent) Postgres instance instead of the built-in embedded dev database.

## Quick start

1. Create a database on your Postgres server:

```bash
psql -c "CREATE DATABASE boringos;" postgres://user:pass@host:5432/postgres
```

2. Set the env vars:

```bash
export DATABASE_URL=postgres://user:pass@host:5432/boringos
export PG_EMBEDDED=false
```

3. Start BoringOS normally. It will connect, run migrations, and boot.

## How the database is selected

BoringOS resolves the database in this order:

1. Explicit `database:` passed to `new BoringOS({ database: ... })` -- always wins.
2. `PG_EMBEDDED=true` -- forces embedded Postgres (useful to pin dev mode explicitly).
3. `PG_EMBEDDED=false` -- forces external Postgres; requires `DATABASE_URL` or BoringOS will exit with an error at boot.
4. `DATABASE_URL` set, `PG_EMBEDDED` unset -- uses external Postgres.
5. Neither set -- embedded Postgres fallback (local dev / quickstart).

| `PG_EMBEDDED` | `DATABASE_URL` | Result |
|---|---|---|
| `true` | any | embedded |
| `false` | set | external |
| `false` | unset | boot error |
| unset | set | external |
| unset | unset | embedded |

## Postgres version

Postgres 15 or newer is required. The migrations use `gen_random_uuid()` which became a built-in (no extension required) in Postgres 13, but 15+ is the tested baseline.

## Recommended providers

Any standard Postgres works. Commonly used with BoringOS:

- **Supabase** -- managed Postgres with a built-in connection pooler. See pooler note below.
- **Neon** -- serverless Postgres, branching support.
- **Amazon RDS / Aurora** -- production-grade managed Postgres.
- **Crunchy Data** -- operator-managed Postgres on Kubernetes.
- **Local Docker** -- `docker run --rm -d -e POSTGRES_USER=boringos -e POSTGRES_PASSWORD=boringos -e POSTGRES_DB=boringos -p 5432:5432 postgres:16`

## Connection poolers (pgBouncer in transaction mode)

Supabase and some other providers use pgBouncer in transaction mode by default. Transaction-mode poolers do not support prepared statements. Add `prepare=false` to your connection string:

```
postgres://user:pass@host:5432/boringos?prepare=false
```

Or set it explicitly in your BoringOS config:

```typescript
new BoringOS({
  database: { url: process.env.DATABASE_URL + "?prepare=false" },
});
```

## Concurrent boots and migrations

BoringOS uses a Postgres advisory lock (`pg_advisory_lock(727363677)`) during the migration step. If multiple processes start simultaneously against the same database (e.g. two workers in a BullMQ cluster), only one runs the DDL at a time. The others wait and proceed once the lock is released. This is safe and automatic.

## The operator must create the database

BoringOS does not create the database itself. If the database does not exist at boot time, you will see an error like:

```
Could not connect to DATABASE_URL: database "boringos" does not exist.
Ensure the database exists and the connection string is correct.
```

Create the database before starting BoringOS. Schema tables are created automatically on first boot via idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

## Embedded Postgres (dev only)

The embedded Postgres path (default when `DATABASE_URL` is unset) starts a native Postgres binary managed by the `embedded-postgres` npm package. It stores data in `.data/postgres` relative to the working directory and is intended for local development and `npx create-boringos` quickstarts. Do not use it in production.

`embedded-postgres` is an optional dependency. It is installed by default (pnpm installs optional deps), so local dev and quickstart work out of the box. Production Docker images that only need external Postgres can skip it:

```bash
npm install --omit=optional
# or
pnpm install --no-optional
```

If BoringOS starts without `DATABASE_URL` and `embedded-postgres` is not installed, it exits with a clear error pointing to the missing package.
