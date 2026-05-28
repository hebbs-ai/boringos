/**
 * Connector discovery — scans node_modules/@boringos/connector-* and
 * dynamic-imports the convention-named ConnectorDefinition export.
 *
 * Uses a real temp directory with a fake node_modules layout because
 * mocking Node's resolver is more fragile than letting it walk the
 * actual filesystem.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConnectors } from "../src/connector-discovery.js";

describe("discoverConnectors", () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "boringos-discover-test-"));

    // Fake @boringos/connector-fake1 with a valid ConnectorDefinition.
    const pkg1 = join(rootDir, "node_modules", "@boringos", "connector-fake1");
    await mkdir(pkg1, { recursive: true });
    await writeFile(join(pkg1, "package.json"), JSON.stringify({
      name: "@boringos/connector-fake1",
      version: "0.0.1",
      type: "module",
      main: "index.js",
    }));
    await writeFile(join(pkg1, "index.js"), `
      export const fake1Connector = {
        provider: "fake1",
        displayName: "Fake1",
        version: 1,
        auth: [],
        services: [],
        resolveAccountId: () => "n/a",
      };
    `);

    // Fake @boringos/connector-broken with NO matching export.
    const pkg2 = join(rootDir, "node_modules", "@boringos", "connector-broken");
    await mkdir(pkg2, { recursive: true });
    await writeFile(join(pkg2, "package.json"), JSON.stringify({
      name: "@boringos/connector-broken",
      version: "0.0.1",
      type: "module",
      main: "index.js",
    }));
    await writeFile(join(pkg2, "index.js"), `
      export const wrongName = { whatever: true };
    `);

    // Sibling directory NOT matching the connector-* prefix; should be ignored.
    const noise = join(rootDir, "node_modules", "@boringos", "shared");
    await mkdir(noise, { recursive: true });
    await writeFile(join(noise, "package.json"), JSON.stringify({
      name: "@boringos/shared",
      version: "0.0.1",
    }));
  });

  afterAll(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });

  it("discovers @boringos/connector-* packages with the convention export", async () => {
    const found = await discoverConnectors(rootDir);
    const providers = found.map((f) => f.provider).sort();
    expect(providers).toEqual(["fake1"]);
    expect(found[0]?.packageName).toBe("@boringos/connector-fake1");
    expect(found[0]?.definition.provider).toBe("fake1");
    expect(found[0]?.definition.displayName).toBe("Fake1");
  });

  it("skips packages that load but lack the convention-named export", async () => {
    // connector-broken should NOT appear in the result, but discovery
    // should not crash either.
    const found = await discoverConnectors(rootDir);
    expect(found.find((f) => f.packageName === "@boringos/connector-broken")).toBeUndefined();
  });

  it("returns an empty array when cwd has no node_modules/@boringos directory", async () => {
    const empty = await mkdtemp(join(tmpdir(), "boringos-discover-empty-"));
    try {
      const found = await discoverConnectors(empty);
      expect(found).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("does not duplicate when the same package appears in multiple search roots", async () => {
    // The discoverConnectors function searches two roots; ensure dedupe works
    // when the same package would resolve via both.
    const found = await discoverConnectors(rootDir);
    const fake1Hits = found.filter((f) => f.packageName === "@boringos/connector-fake1");
    expect(fake1Hits).toHaveLength(1);
  });
});
