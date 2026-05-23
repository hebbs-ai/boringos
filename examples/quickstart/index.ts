/**
 * BoringOS Quickstart
 *
 * Boots an BoringOS server, creates a tenant and agent,
 * assigns a task, and watches the agent execute.
 *
 * Run: npx tsx index.ts
 * Idempotent: re-running reuses the existing tenant, agent, and runtime.
 */
import { BoringOS } from "@boringos/core";
import { tenants, agents, tasks, runtimes, agentRuns } from "@boringos/db";
import { eq, and } from "drizzle-orm";

async function main() {
  console.log("Booting BoringOS...");

  const app = new BoringOS({});
  const server = await app.listen(3000);

  console.log(`Server running at ${server.url}`);
  console.log(`Health check: ${server.url}/health`);

  const db = server.context.db as import("@boringos/db").Db;

  // 1. Get or create tenant
  const TENANT_SLUG = "acme-corp";
  let [tenant] = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  if (!tenant) {
    [tenant] = await db.insert(tenants).values({
      name: "Acme Corp",
      slug: TENANT_SLUG,
    }).returning();
    console.log(`\nCreated tenant: Acme Corp (${tenant.id})`);
  } else {
    console.log(`\nReusing tenant: Acme Corp (${tenant.id})`);
  }
  const tenantId = tenant.id;

  // 2. Get or create runtime
  let [runtime] = await db.select().from(runtimes)
    .where(and(eq(runtimes.tenantId, tenantId), eq(runtimes.name, "echo-agent")))
    .limit(1);
  if (!runtime) {
    [runtime] = await db.insert(runtimes).values({
      tenantId,
      name: "echo-agent",
      type: "command",
      config: { command: "cat" },
    }).returning();
  }

  // 3. Get or create agent
  let [agent] = await db.select().from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.name, "Code Bot")))
    .limit(1);
  if (!agent) {
    [agent] = await db.insert(agents).values({
      tenantId,
      name: "Code Bot",
      role: "engineer",
      instructions: "You are a helpful coding agent.",
      runtimeId: runtime.id,
    }).returning();
    console.log(`Created agent: Code Bot (${agent.id})`);
  } else {
    console.log(`Reusing agent: Code Bot (${agent.id})`);
  }

  // 4. Create a new task every run
  const taskNum = Date.now();
  const [task] = await db.insert(tasks).values({
    tenantId,
    title: "Add health endpoint",
    description: "Add a GET /health endpoint that returns { status: 'ok' }.",
    status: "todo",
    priority: "medium",
    assigneeAgentId: agent.id,
    identifier: `ACME-${taskNum}`,
    originKind: "manual",
  }).returning();
  console.log(`Created task: ${task.identifier} — ${task.title}`);

  // 5. Wake the agent
  const engine = server.context.agentEngine!;
  const outcome = await engine.wake({
    agentId: agent.id,
    tenantId,
    reason: "manual_request",
    taskId: task.id,
  });

  if (outcome.kind === "created") {
    console.log(`\nAgent woken! Wakeup ID: ${outcome.wakeupRequestId}`);
    await engine.enqueue(outcome.wakeupRequestId);

    // Wait for completion
    console.log("Waiting for agent to finish...\n");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentId, agent.id)).limit(1);
      if (runs[0]?.status === "done" || runs[0]?.status === "failed") {
        console.log(`Run completed — status: ${runs[0].status}, exit code: ${runs[0].exitCode}`);
        if (runs[0].stdoutExcerpt) {
          console.log("\n--- Agent received this context (first 500 chars) ---");
          console.log(runs[0].stdoutExcerpt.slice(0, 500));
          console.log("---");
        }
        break;
      }
    }
  }

  console.log("\nServer still running at", server.url);
  console.log("Press Ctrl+C to stop.");
}

main().catch(console.error);
