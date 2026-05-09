// Integration test for GET /api/admin/drive/file/* — exercises a
// real BoringOS server with embedded Postgres + local drive.
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "drive-file-route-key";

async function boot(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const { generateId } = await import("@boringos/shared");
  const { tenants } = await import("@boringos/db");

  const root = await mkdtemp(join(tmpdir(), "boringos-drive-route-"));
  const driveRoot = join(root, "drive");

  const server = await new BoringOS({
    database: { embedded: true, dataDir: root, port },
    drive: { root: driveRoot },
    auth: { secret: "s", adminKey: KEY },
  }).listen(0);

  const db = server.context.db as import("@boringos/db").Db;
  const tid = generateId();
  await db.insert(tenants).values({ id: tid, name: "Co", slug: `co-${tid.slice(0, 6)}` });

  return { server, db, tid, driveRoot };
}

describe("GET /api/admin/drive/file/*", () => {
  it("streams a file's bytes with the correct Content-Type", async () => {
    const { server, db, tid, driveRoot } = await boot(5601);
    try {
      const { driveFiles } = await import("@boringos/db");
      const { generateId } = await import("@boringos/shared");

      // Stage a PNG-ish file at <tenantId>/tasks/T-1/chart.png.
      const dir = join(driveRoot, tid, "tasks", "T-1");
      await mkdir(dir, { recursive: true });
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
      await writeFile(join(dir, "chart.png"), pngBytes);

      // Index the file so the route can compute an ETag.
      await db.insert(driveFiles).values({
        id: generateId(),
        tenantId: tid,
        path: "tasks/T-1/chart.png",
        filename: "chart.png",
        format: "png",
        size: pngBytes.length,
        hash: "abc123",
      });

      const r = await fetch(`${server.url}/api/admin/drive/file/tasks/T-1/chart.png`, {
        headers: { "X-API-Key": KEY, "X-Tenant-Id": tid },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(r.headers.get("etag")).toBe('"abc123"');
      const got = new Uint8Array(await r.arrayBuffer());
      expect(Array.from(got)).toEqual(Array.from(pngBytes));
    } finally {
      await server.close();
    }
  });

  it("returns 304 when If-None-Match matches the ETag", async () => {
    const { server, db, tid, driveRoot } = await boot(5602);
    try {
      const { driveFiles } = await import("@boringos/db");
      const { generateId } = await import("@boringos/shared");

      const dir = join(driveRoot, tid, "tasks", "T-1");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "x.txt"), "hello");
      await db.insert(driveFiles).values({
        id: generateId(),
        tenantId: tid,
        path: "tasks/T-1/x.txt",
        filename: "x.txt",
        format: "txt",
        size: 5,
        hash: "xyz",
      });

      const r = await fetch(`${server.url}/api/admin/drive/file/tasks/T-1/x.txt`, {
        headers: { "X-API-Key": KEY, "X-Tenant-Id": tid, "If-None-Match": '"xyz"' },
      });
      expect(r.status).toBe(304);
    } finally {
      await server.close();
    }
  });

  it("rejects path traversal", async () => {
    const { server, tid } = await boot(5603);
    try {
      const r = await fetch(`${server.url}/api/admin/drive/file/..%2Fetc%2Fpasswd`, {
        headers: { "X-API-Key": KEY, "X-Tenant-Id": tid },
      });
      expect(r.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for missing files", async () => {
    const { server, tid } = await boot(5604);
    try {
      const r = await fetch(`${server.url}/api/admin/drive/file/tasks/T-1/nope.png`, {
        headers: { "X-API-Key": KEY, "X-Tenant-Id": tid },
      });
      expect(r.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 401 without auth", async () => {
    const { server } = await boot(5605);
    try {
      const r = await fetch(`${server.url}/api/admin/drive/file/tasks/T-1/x.png`);
      expect(r.status).toBe(401);
    } finally {
      await server.close();
    }
  });
});
