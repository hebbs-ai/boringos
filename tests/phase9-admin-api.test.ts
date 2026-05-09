/**
 * Phase 9 Smoke Tests — Admin API
 *
 * Tests the /api/admin/* REST endpoints for human management of the platform.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN_KEY = "test-admin-key";

async function bootServer() {
  const { BoringOS } = await import("@boringos/core");
  const dataDir = await mkdtemp(join(tmpdir(), "boringos-admin-"));
  const app = new BoringOS({
    database: { embedded: true, dataDir, port: 5588 },
    drive: { root: join(dataDir, "drive") },
    auth: { secret: "test-secret", adminKey: ADMIN_KEY },
  });
  return app.listen(0);
}

function adminHeaders(tenantId: string) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": ADMIN_KEY,
    "X-Tenant-Id": tenantId,
  };
}

describe("admin API: auth", () => {
  it("rejects requests without API key", async () => {
    const server = await bootServer();
    try {
      const res = await fetch(`${server.url}/api/admin/agents`);
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  it("rejects requests without tenant ID", async () => {
    const server = await bootServer();
    try {
      const res = await fetch(`${server.url}/api/admin/agents`, {
        headers: { "X-API-Key": ADMIN_KEY },
      });
      expect(res.status).toBe(400);
    } finally {
      await server.close();
    }
  }, 30000);
});

describe("admin API: full CRUD flow", () => {
  it("create tenant → agent → task → assign → wake → view run", async () => {
    const server = await bootServer();

    try {
      // 1. Create tenant
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;

      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Admin Test", slug: "admin-test" });

      const h = adminHeaders(tenantId);

      // 2. Create a runtime (command type for testing)
      const rtRes = await fetch(`${server.url}/api/admin/runtimes`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "echo-rt", type: "command", config: { command: "echo", args: ["done"] } }),
      });
      expect(rtRes.status).toBe(201);
      const runtime = await rtRes.json() as Record<string, string>;

      // 3. Create agent
      const agentRes = await fetch(`${server.url}/api/admin/agents`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "Admin Bot", role: "engineer", runtimeId: runtime.id }),
      });
      expect(agentRes.status).toBe(201);
      const agent = await agentRes.json() as Record<string, string>;
      expect(agent.name).toBe("Admin Bot");

      // 4. List agents
      const listRes = await fetch(`${server.url}/api/admin/agents`, { headers: h });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json() as { agents: Array<{ id: string }> };
      expect(listBody.agents).toHaveLength(1);

      // 5. Create task
      const taskRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ title: "Admin task", description: "Test task from admin API" }),
      });
      expect(taskRes.status).toBe(201);
      const task = await taskRes.json() as Record<string, string>;

      // 6. Assign task to agent + wake
      const assignRes = await fetch(`${server.url}/api/admin/tasks/${task.id}/assign`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ agentId: agent.id, wake: true }),
      });
      expect(assignRes.status).toBe(200);
      const assignBody = await assignRes.json() as { assigned: boolean; wakeup: { kind: string } };
      expect(assignBody.assigned).toBe(true);
      expect(assignBody.wakeup.kind).toBe("created");

      // 7. Wait for run to complete
      await new Promise((r) => setTimeout(r, 1000));

      // 8. List runs
      const runsRes = await fetch(`${server.url}/api/admin/runs`, { headers: h });
      expect(runsRes.status).toBe(200);
      const runsBody = await runsRes.json() as { runs: Array<{ status: string }> };
      expect(runsBody.runs.length).toBeGreaterThanOrEqual(1);

      // 9. Post comment on task
      const commentRes = await fetch(`${server.url}/api/admin/tasks/${task.id}/comments`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ body: "Looking good!" }),
      });
      expect(commentRes.status).toBe(201);

      // 10. Get task detail with comments
      const detailRes = await fetch(`${server.url}/api/admin/tasks/${task.id}`, { headers: h });
      const detail = await detailRes.json() as { task: Record<string, string>; comments: Array<{ body: string }> };
      expect(detail.comments).toHaveLength(1);
      expect(detail.comments[0].body).toBe("Looking good!");

      // 11. Update task
      await fetch(`${server.url}/api/admin/tasks/${task.id}`, {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ status: "done" }),
      });
      const updatedRes = await fetch(`${server.url}/api/admin/tasks/${task.id}`, { headers: h });
      const updated = await updatedRes.json() as { task: { status: string } };
      expect(updated.task.status).toBe("done");

    } finally {
      await server.close();
    }
  }, 30000);
});

// Approvals are now represented as tasks with originKind: "agent_action"
// See docs/blockers/done/task_06_collapse_approvals_into_tasks.md
describe("admin API: approvals", () => {
  it("agent_action tasks represent approvals pending decision", async () => {
    const server = await bootServer();

    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, tasks } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;

      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Approval Test", slug: "approval-test" });

      // Create an approval task (originKind: "agent_action" with metadata.approval)
      const approvalId = generateId();
      await db.insert(tasks).values({
        id: approvalId,
        tenantId,
        title: "Approve deployment",
        originKind: "agent_action",
        status: "todo",
        priority: "high",
        metadata: {
          approval: {
            message: "Deploy to production?",
          },
        },
      });

      const h = adminHeaders(tenantId);

      // List pending (filter by originKind: "agent_action")
      const listRes = await fetch(`${server.url}/api/admin/tasks`, { headers: h });
      const listBody = await listRes.json() as { tasks: Array<{ id: string; originKind: string }> };
      const approvalTasks = listBody.tasks.filter((t) => t.originKind === "agent_action");
      expect(approvalTasks.length).toBeGreaterThan(0);

      // Verify task can be viewed
      const detailRes = await fetch(`${server.url}/api/admin/tasks/${approvalId}`, { headers: h });
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json() as { task: { status: string } };
      expect(detail.task.status).toBe("todo");
    } finally {
      await server.close();
    }
  }, 30000);
});
