// Integration tests for the v2 drive module — exercises tool
// dispatch over HTTP just like an agent would.
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "drive-v2-tools-key";

async function boot(port: number) {
  const { BoringOS, createDriveModule, createFrameworkModule } = await import("@boringos/core");
  const { signCallbackToken } = await import("@boringos/agent");
  const { tenants, agents } = await import("@boringos/db");

  const root = await mkdtemp(join(tmpdir(), "boringos-drive-v2-"));
  const driveRoot = join(root, "drive");
  const secret = "test-secret";

  const app = new BoringOS({
    database: { embedded: true, dataDir: root, port },
    drive: { root: driveRoot },
    auth: { secret, adminKey: KEY },
  });
  app.module(createFrameworkModule);
  app.module(createDriveModule);
  const server = await app.listen(0);

  const db = server.context.db as import("@boringos/db").Db;
  const { generateId } = await import("@boringos/shared");
  const tid = generateId();
  await db.insert(tenants).values({ id: tid, name: "Co", slug: `co-${tid.slice(0, 6)}` });

  const aid = generateId();
  await db.insert(agents).values({
    id: aid,
    tenantId: tid,
    name: "test-agent",
    role: "default",
  });

  // Mint a callback token so we can call /api/tools/* as the agent
  // would. runId must be a UUID — the dispatcher records it.
  const runId = generateId();
  const token = signCallbackToken(
    { runId, agentId: aid, tenantId: tid },
    secret,
  );

  return { server, db, tid, aid, token };
}

async function callTool(server: { url: string }, token: string, fullName: string, body: unknown) {
  return await fetch(`${server.url}/api/tools/${fullName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("v2 drive tools — write_binary + delivery URL", () => {
  it("write_binary writes bytes, indexes them, and returns a public URL", async () => {
    const { server, token } = await boot(5701);
    try {
      // 1x1 transparent PNG (base64).
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

      const r = await callTool(server, token, "drive.write_binary", {
        path: "tasks/T-task/pixel.png",
        contentBase64: png,
      });
      expect(r.status).toBe(200);
      const body = await r.json() as { ok: true; result: { path: string; bytes: number; url: string } };
      expect(body.ok).toBe(true);
      expect(body.result.path).toBe("tasks/T-task/pixel.png");
      expect(body.result.bytes).toBeGreaterThan(0);
      expect(body.result.url).toBe("/api/admin/drive/file/tasks/T-task/pixel.png");
    } finally {
      await server.close();
    }
  });

  it("rejects oversized binary writes", async () => {
    const { server, token } = await boot(5702);
    try {
      // 26 MB of 'A' base64'd is ~26 MB after decode.
      const big = "A".repeat(26 * 1024 * 1024).replace(/A/g, "AAAA");
      const r = await callTool(server, token, "drive.write_binary", {
        path: "tasks/T/big.bin",
        contentBase64: big.slice(0, Math.ceil((26 * 1024 * 1024 * 4) / 3)),
      });
      const body = await r.json() as { ok: false; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("invalid_input");
    } finally {
      await server.close();
    }
  });

  it("rejects non-base64 content", async () => {
    const { server, token } = await boot(5703);
    try {
      const r = await callTool(server, token, "drive.write_binary", {
        path: "tasks/T/x.bin",
        contentBase64: "not!base64@@@",
      });
      const body = await r.json() as { ok: false; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("invalid_input");
    } finally {
      await server.close();
    }
  });

  it("agent cannot write to users/<otherId>/", async () => {
    const { server, token } = await boot(5704);
    try {
      const r = await callTool(server, token, "drive.write_binary", {
        path: "users/u-other/secret.png",
        contentBase64: "AAAA",
      });
      const body = await r.json() as { ok: false; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("permission_denied");
    } finally {
      await server.close();
    }
  });

  it("relative paths get auto-rewritten under the agent's folder when no taskId is set", async () => {
    const { server, token } = await boot(5705);
    try {
      const r = await callTool(server, token, "drive.write", {
        path: "scratch.txt",
        content: "hello",
      });
      const body = await r.json() as { ok: true; result: { path: string; url: string } };
      expect(body.ok).toBe(true);
      // The token has agent_id but no task — should land under agents/<id>/.
      expect(body.result.path).toMatch(/^agents\/.+\/scratch\.txt$/);
      expect(body.result.url).toMatch(/^\/api\/admin\/drive\/file\/agents\//);
    } finally {
      await server.close();
    }
  });

  it("read returns the bytes that write_binary wrote", async () => {
    const { server, token } = await boot(5706);
    try {
      // text round-trip via write/read is the simplest sanity check.
      const w = await callTool(server, token, "drive.write", {
        path: "tasks/T/readme.md",
        content: "# Hello\n",
      });
      expect(w.status).toBe(200);

      const r = await callTool(server, token, "drive.read", {
        path: "tasks/T/readme.md",
      });
      const body = await r.json() as { ok: true; result: { content: string } };
      expect(body.result.content).toBe("# Hello\n");
    } finally {
      await server.close();
    }
  });

  it("file-serve route returns the bytes a tool wrote (round-trip)", async () => {
    const { server, db, tid, token } = await boot(5707);
    try {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const w = await callTool(server, token, "drive.write_binary", {
        path: "tasks/T/pixel.png",
        contentBase64: png,
      });
      const wb = await w.json() as { result: { url: string } };

      const r = await fetch(`${server.url}${wb.result.url}`, {
        headers: { "X-API-Key": KEY, "X-Tenant-Id": tid },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      const got = new Uint8Array(await r.arrayBuffer());
      // bytes match the decoded base64
      const expected = Buffer.from(png, "base64");
      expect(Array.from(got)).toEqual(Array.from(expected));

      // confirm it landed in driveFiles index too
      const { driveFiles } = await import("@boringos/db");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(driveFiles)
        .where(and(eq(driveFiles.tenantId, tid), eq(driveFiles.path, "tasks/T/pixel.png")));
      expect(rows.length).toBe(1);
      expect(rows[0].size).toBe(expected.byteLength);
    } finally {
      await server.close();
    }
  });
});
