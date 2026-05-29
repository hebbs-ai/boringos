# Hebbs MDK — Docker recipe

A turnkey Postgres instance for `hebbs dev`. Equivalent in spirit to
WordPress's `wp-env` — one `docker compose up -d` and your module
has a database to talk to. The framework itself (Node + the host
process) still runs on your machine; a fully-containerised
`hebbs dev --docker` will arrive once `@boringos/shell` ships as a
published image.

## When to use

`hebbs dev` boots an **embedded Postgres** by default — for most
authors that's all you need. Reach for this recipe when:

- You're iterating across `hebbs dev` restarts and want data to
  persist outside the per-run tmp dir.
- You're hitting `kern.sysv.shmmni` limits on macOS (each embedded
  Postgres leaks a SysV shm segment until the host exits; running one
  long-lived container instead avoids the leak entirely).
- Your CI / dev machine already has Docker but not Postgres natively.

If those don't apply, the embedded default is faster and simpler.

## Quick start

```bash
# 1. Boot Postgres
cd recipes/docker
docker compose up -d

# 2. Point hebbs dev at it
cd /path/to/your-module
hebbs dev . \
  --postgres-url postgres://boringos:boringos@127.0.0.1:5439/boringos
```

Equivalent via env var (handy in scripts):

```bash
export DATABASE_URL=postgres://boringos:boringos@127.0.0.1:5439/boringos
hebbs dev /path/to/your-module
```

## Lifecycle

```bash
docker compose ps           # status
docker compose logs -f      # tail postgres logs
docker compose down         # stop, keep volume
docker compose down -v      # stop and wipe the volume
```

The volume is named `hebbs-dev-pgdata` and survives restarts of the
container. Wipe it (or `docker compose down -v`) to start with a
clean schema — handy when you're iterating on a module's migrations.

## Notes

- Port `5439` is intentional: it avoids collisions with the
  per-machine default `5432` and the embedded-Postgres port range.
- The user / password / database are all `boringos` to match
  framework defaults; nothing here is meant for production.
- Bound to `127.0.0.1` only — this is a dev recipe, not LAN-safe.

## Roadmap

- `hebbs dev --docker` — orchestrates this Compose file + the
  framework Shell image. Blocked on shipping `@boringos/shell` as a
  published OCI image. Tracked alongside Phase 6 follow-ups.
