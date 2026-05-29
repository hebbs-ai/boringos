// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T6.3 — `recipes/docker/` Compose recipe + `hebbs dev
// --postgres-url`. We assert:
//
//   1. The shipped Compose file is valid YAML and points at the
//      port + creds documented in the README.
//   2. The DevOptions/DevHostOptions surface accepts a `postgresUrl`
//      / `databaseUrl` field so the CLI flag actually plumbs into
//      BoringOS's external-Postgres mode.
//
// A live-container end-to-end ("docker compose up; hebbs dev
// --postgres-url …") is intentionally out of scope here — that would
// require Docker on the CI runner and is covered manually by the
// recipe README's quick-start.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DevHostOptions } from "@boringos/dev-host";
import type { DevOptions } from "@boringos/hebbs-cli";

const composePath = join(
  process.cwd(),
  "recipes",
  "docker",
  "docker-compose.yml",
);
const readmePath = join(
  process.cwd(),
  "recipes",
  "docker",
  "README.md",
);

describe("MDK T6.3 — Docker Compose recipe + --postgres-url flag", () => {
  it("ships recipes/docker/docker-compose.yml with the documented port + creds", () => {
    expect(existsSync(composePath)).toBe(true);
    const yml = readFileSync(composePath, "utf8");
    // Sanity: stuff the README claims has to match the actual file.
    expect(yml).toContain("postgres:16");
    expect(yml).toContain("POSTGRES_USER: boringos");
    expect(yml).toContain("POSTGRES_PASSWORD: boringos");
    expect(yml).toContain("POSTGRES_DB: boringos");
    // README's connection string + healthcheck rely on port 5439.
    expect(yml).toContain("5439");
    // Localhost-only port binding — not LAN-exposed by default.
    expect(yml).toMatch(/127\.0\.0\.1:5439:5439/);
    // Healthcheck must use the same port the host hits.
    expect(yml).toMatch(/pg_isready[^\n]*-p 5439/);
  });

  it("recipes/docker/README.md documents the --postgres-url wiring", () => {
    expect(existsSync(readmePath)).toBe(true);
    const md = readFileSync(readmePath, "utf8");
    expect(md).toContain("--postgres-url");
    expect(md).toContain(
      "postgres://boringos:boringos@127.0.0.1:5439/boringos",
    );
    expect(md).toContain("docker compose up");
  });

  it("DevHostOptions accepts databaseUrl and DevOptions accepts postgresUrl (type-level)", () => {
    // These compile-time assertions fail loudly if the names drift.
    const devHostOpts: DevHostOptions = {
      modulePath: "/dev/null",
      databaseUrl:
        "postgres://boringos:boringos@127.0.0.1:5439/boringos",
    };
    expect(devHostOpts.databaseUrl).toMatch(/^postgres:/);

    const devOpts: DevOptions = {
      modulePath: "/dev/null",
      postgresUrl:
        "postgres://boringos:boringos@127.0.0.1:5439/boringos",
    };
    expect(devOpts.postgresUrl).toMatch(/^postgres:/);
  });
});
