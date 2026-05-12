// task_23 F2 — wake-context resolver tests.
//
// Validates that the resolver correctly identifies the wake's
// human owner across the four real wake-source shapes:
//   1. task created by a user (most common — copilot, manual)
//   2. agent-spawned subtask whose parent was user-created (the
//      walk-the-chain case)
//   3. routine / cron / webhook task (createdByUserId is null,
//      no parent with a user — should resolve to null)
//   4. assignee-only task (no creator, but assigned to a user —
//      handoff inbox shape)

import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("resolveWakeContext", () => {
  let app: import("@boringos/core").BoringOS;
  let server: { url: string };
  let db: import("@boringos/db").Db;
  let dataDir: string;

  const T = "44444444-4444-4444-8444-444444444444";
  const A = "55555555-5555-4555-8555-555555555555";
  const U = "66666666-6666-4666-8666-666666666666";
  const V = "77777777-7777-4777-8777-777777777777";

  beforeAll(async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    dataDir = await mkdtemp(join(tmpdir(), "boringos-wakectx-"));
    app = new BoringOS({
      database: { embedded: true, dataDir, port: 5593 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "test-secret-wakectx" },
    });
    server = await app.listen(0);
    db = (server as unknown as { context: { db: import("@boringos/db").Db } })
      .context.db;

    const { tenants, agents } = await import("@boringos/db");
    await db.insert(tenants).values({ id: T, name: "T", slug: "t" }).onConflictDoNothing();
    await db
      .insert(agents)
      .values({ id: A, tenantId: T, name: "A", role: "general" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await app?.close?.();
  });

  it("resolves owner from createdByUserId on the task", async () => {
    const { tasks } = await import("@boringos/db");
    const { resolveWakeContext } = await import("@boringos/agent");
    const taskId = "10000000-0000-4000-8000-000000000001";
    await db
      .insert(tasks)
      .values({ id: taskId, tenantId: T, title: "x", createdByUserId: U })
      .onConflictDoNothing();

    const ctx = await resolveWakeContext(db, {
      wakeupRequestId: "w1",
      agentId: A,
      tenantId: T,
      wakeReason: "user_message",
      taskId,
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.ownerUserId).toBe(U);
    expect(ctx?.taskId).toBe(taskId);
  });

  it("walks the parent chain when the leaf has no creator user", async () => {
    const { tasks } = await import("@boringos/db");
    const { resolveWakeContext } = await import("@boringos/agent");
    const parentId = "10000000-0000-4000-8000-000000000010";
    const childId = "10000000-0000-4000-8000-000000000011";
    await db
      .insert(tasks)
      .values({ id: parentId, tenantId: T, title: "parent", createdByUserId: V })
      .onConflictDoNothing();
    await db
      .insert(tasks)
      .values({
        id: childId,
        tenantId: T,
        title: "child",
        parentId,
        createdByAgentId: A,
      })
      .onConflictDoNothing();

    const ctx = await resolveWakeContext(db, {
      wakeupRequestId: "w2",
      agentId: A,
      tenantId: T,
      wakeReason: "agent_subtask",
      taskId: childId,
    });

    expect(ctx?.ownerUserId).toBe(V);
  });

  it("returns null owner for routine-style tasks with no user anywhere in the chain", async () => {
    const { tasks } = await import("@boringos/db");
    const { resolveWakeContext } = await import("@boringos/agent");
    const taskId = "10000000-0000-4000-8000-000000000020";
    await db
      .insert(tasks)
      .values({
        id: taskId,
        tenantId: T,
        title: "routine",
        createdByAgentId: A,
      })
      .onConflictDoNothing();

    const ctx = await resolveWakeContext(db, {
      wakeupRequestId: "w3",
      agentId: A,
      tenantId: T,
      wakeReason: "routine",
      taskId,
    });

    expect(ctx?.ownerUserId).toBeNull();
  });

  it("falls back to assigneeUserId when there's no creator", async () => {
    const { tasks } = await import("@boringos/db");
    const { resolveWakeContext } = await import("@boringos/agent");
    const taskId = "10000000-0000-4000-8000-000000000030";
    await db
      .insert(tasks)
      .values({
        id: taskId,
        tenantId: T,
        title: "handoff",
        assigneeUserId: U,
      })
      .onConflictDoNothing();

    const ctx = await resolveWakeContext(db, {
      wakeupRequestId: "w4",
      agentId: A,
      tenantId: T,
      wakeReason: "handoff",
      taskId,
    });

    expect(ctx?.ownerUserId).toBe(U);
  });

  it("returns null when job has no taskId", async () => {
    const { resolveWakeContext } = await import("@boringos/agent");
    const ctx = await resolveWakeContext(db, {
      wakeupRequestId: "w5",
      agentId: A,
      tenantId: T,
      wakeReason: "noop",
    });
    expect(ctx).toBeNull();
  });
});
