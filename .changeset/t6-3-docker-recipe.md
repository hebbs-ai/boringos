---
"@boringos/dev-host": minor
"@boringos/hebbs-cli": minor
---

`recipes/docker/` Compose recipe + `hebbs dev --postgres-url` (MDK T6.3, scope-down).

- New `recipes/docker/docker-compose.yml` — Postgres 16 on `127.0.0.1:5439`, named volume `hebbs-dev-pgdata`, healthchecked. The "wp-env-equivalent" for module authors who want persistent state across `hebbs dev` restarts or are hitting macOS `kern.sysv.shmmni` shm limits with the embedded default.
- `recipes/docker/README.md` — quickstart, when-to-use guidance, lifecycle commands, and a roadmap note pointing at the deferred full `hebbs dev --docker` flag.
- `DevHostOptions.databaseUrl` — opt out of embedded Postgres and point at an external instance. Migrations still run on boot.
- `hebbs dev --postgres-url <url>` (or `$DATABASE_URL`) — surfaces the same option through the CLI. The boot summary now shows `postgres: embedded | external`.

The full `hebbs dev --docker` flag (orchestrates this Compose file + a containerised Shell+Core) is **deferred** — it requires `@boringos/shell` to ship as a published OCI image, which is a separate piece of work.
