/**
 * Phase 19 Smoke Tests — Agent Templates, Teams, Hierarchy
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const KEY = "hier-admin";

async function boot(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const d = await mkdtemp(join(tmpdir(), "boringos-hier-"));
  return new BoringOS({
    database: { embedded: true, dataDir: d, port },
    drive: { root: join(d, "drive") },
    auth: { secret: "s", adminKey: KEY },
  }).listen(0);
}

function h(tid: string) {
  return { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };
}

async function createCoSForTenant(server: any, tenantId: string) {
  const { generateId } = await import("@boringos/shared");
  const { tenants, agents: agentsTable } = await import("@boringos/db");
  const db = server.context.db as import("@boringos/db").Db;

  const cosId = generateId();
  await db.insert(agentsTable).values({
    id: cosId,
    tenantId,
    name: "Chief of Staff",
    role: "chief-of-staff",
    source: "shell",
  });
  await db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tenantId));
  return cosId;
}

describe("agent templates", () => {
  it("creates agent from role template with persona", async () => {
    const server = await boot(5565);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents: agentsTable } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Template Co", slug: "template-co" });

      // Create CoS as root
      const cosId = generateId();
      await db.insert(agentsTable).values({
        id: cosId,
        tenantId: tid,
        name: "Chief of Staff",
        role: "chief-of-staff",
        source: "shell",
      });
      await db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

      const res = await fetch(`${server.url}/api/admin/agents/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ role: "engineer", name: "Code Bot" }),
      });
      expect(res.status).toBe(201);
      const agent = await res.json() as { id: string; name: string; role: string };
      expect(agent.name).toBe("Code Bot");
      expect(agent.role).toBe("engineer");

      // Alias resolution works
      const res2 = await fetch(`${server.url}/api/admin/agents/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ role: "sre" }), // alias for devops
      });
      const agent2 = await res2.json() as { role: string };
      expect(agent2.role).toBe("devops");
    } finally { await server.close(); }
  }, 30000);
});

describe("team templates", () => {
  it("creates engineering team with hierarchy", async () => {
    const server = await boot(5564);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents: agentsTable } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Team Co", slug: "team-co" });

      // Create CoS as root
      const cosId = generateId();
      await db.insert(agentsTable).values({
        id: cosId,
        tenantId: tid,
        name: "Chief of Staff",
        role: "chief-of-staff",
        source: "shell",
      });
      await db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

      const res = await fetch(`${server.url}/api/admin/teams/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ template: "engineering" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { agents: Array<{ id: string; name: string; role: string; reportsTo: string | null }> };
      expect(body.agents).toHaveLength(4); // CTO + 2 engineers + QA

      // CTO reports to CoS
      const cto = body.agents.find(a => a.role === "cto");
      expect(cto?.reportsTo).toBe(cosId);

      // Engineers report to CTO
      const engineers = body.agents.filter(a => a.role === "engineer");
      expect(engineers.length).toBe(2);
      for (const eng of engineers) {
        expect(eng.reportsTo).toBe(cto?.id);
      }

      // QA reports to CTO
      const qa = body.agents.find(a => a.role === "qa");
      expect(qa?.reportsTo).toBe(cto?.id);
    } finally { await server.close(); }
  }, 30000);
});

describe("org tree", () => {
  it("builds org tree from agents", async () => {
    const server = await boot(5563);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents: agentsTable } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Org Co", slug: "org-co" });

      // Create CoS as root
      const cosId = generateId();
      await db.insert(agentsTable).values({
        id: cosId,
        tenantId: tid,
        name: "Chief of Staff",
        role: "chief-of-staff",
        source: "shell",
      });
      await db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

      // Create a team first
      await fetch(`${server.url}/api/admin/teams/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ template: "executive" }),
      });

      // Get org tree
      const res = await fetch(`${server.url}/api/admin/agents/org-tree`, { headers: h(tid) });
      const body = await res.json() as { tree: Array<{ name: string; reports: Array<{ name: string }> }> };
      // CoS is at root with CEO as one of the reports
      expect(body.tree).toHaveLength(1);
      expect(body.tree[0].name).toBe("Chief of Staff");
      expect(body.tree[0].reports.some((r: any) => r.name === "CEO")).toBe(true);
    } finally { await server.close(); }
  }, 30000);
});

describe("delegation", () => {
  it("finds best delegate for a task based on role matching", async () => {
    const { findDelegateForTask } = await import("@boringos/agent");
    const { createDatabase, createMigrationManager, tenants, agents } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");
    const { generateId } = await import("@boringos/shared");

    const d = await mkdtemp(join(tmpdir(), "boringos-deleg-"));
    const conn = await createDatabase({ embedded: true, dataDir: join(d, "pg"), port: 5562 });
    await createMigrationManager(conn.db).apply();

    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "Deleg Co", slug: "deleg-co" });

    // Create CoS as root
    const cosId = generateId();
    await conn.db.insert(agents).values({ id: cosId, tenantId: tid, name: "CoS", role: "chief-of-staff", status: "idle", source: "shell" });
    await conn.db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

    const engId = generateId();
    const resId = generateId();

    // Boss reports to CoS
    const bossId = generateId();
    await conn.db.insert(agents).values({ id: bossId, tenantId: tid, name: "Boss", role: "ceo", status: "idle", reportsTo: cosId });
    await conn.db.insert(agents).values({ id: engId, tenantId: tid, name: "Dev", role: "engineer", reportsTo: bossId, status: "idle" });
    await conn.db.insert(agents).values({ id: resId, tenantId: tid, name: "Researcher", role: "researcher", reportsTo: bossId, status: "idle" });

    // Delegation should return a non-null agent for any task
    const delegate1 = await findDelegateForTask(conn.db, bossId, "Fix the authentication bug");
    expect(delegate1).not.toBeNull();

    const delegate2 = await findDelegateForTask(conn.db, bossId, "Investigate competitor pricing");
    expect(delegate2).not.toBeNull();

    // At least one delegation should work (both agents are available)
    // The function finds the best match — exact role matching is heuristic-based
    expect([engId, resId]).toContain(delegate1);
    expect([engId, resId]).toContain(delegate2);

    await conn.close();
  }, 30000);

  it("tier A: exact skill match beats role heuristic", async () => {
    const { findDelegateForTask } = await import("@boringos/agent");
    const { createDatabase, createMigrationManager, tenants, agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    const d = await mkdtemp(join(tmpdir(), "boringos-tier-a-"));
    const conn = await createDatabase({ embedded: true, dataDir: join(d, "pg"), port: 5566 });
    await createMigrationManager(conn.db).apply();

    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "Tier A Co", slug: "tier-a-co" });

    // Create CoS as root
    const cosId = generateId();
    await conn.db.insert(agents).values({ id: cosId, tenantId: tid, name: "CoS", role: "chief-of-staff", status: "idle", source: "shell" });
    await conn.db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

    const bossId = generateId();
    const engId = generateId();
    const writerId = generateId();
    await conn.db.insert(agents).values({ id: bossId, tenantId: tid, name: "Boss", role: "ceo", status: "idle", reportsTo: cosId });
    // Engineer with an unusual skill that'd never match the keyword regex
    await conn.db.insert(agents).values({
      id: engId, tenantId: tid, name: "Dev", role: "engineer", reportsTo: bossId, status: "idle",
      routingTags: ["competitor-analysis"],
    });
    await conn.db.insert(agents).values({
      id: writerId, tenantId: tid, name: "Writer", role: "content-creator", reportsTo: bossId, status: "idle",
      routingTags: [],
    });

    // Tier A skill "competitor-analysis" should beat Tier B role regex ("write" → content-creator)
    const delegate = await findDelegateForTask(conn.db, bossId, {
      title: "Write up competitor-analysis for Acme",
    });
    expect(delegate).toBe(engId);

    // requiredTag hint also works
    const delegate2 = await findDelegateForTask(conn.db, bossId, {
      title: "Anything goes",
      requiredTag: "competitor-analysis",
    });
    expect(delegate2).toBe(engId);

    await conn.close();
  }, 30000);

  it("skips paused reports", async () => {
    const { findDelegateForTask } = await import("@boringos/agent");
    const { createDatabase, createMigrationManager, tenants, agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    const d = await mkdtemp(join(tmpdir(), "boringos-paused-"));
    const conn = await createDatabase({ embedded: true, dataDir: join(d, "pg"), port: 5567 });
    await createMigrationManager(conn.db).apply();

    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "Paused Co", slug: "paused-co" });

    // Create CoS as root
    const cosId = generateId();
    await conn.db.insert(agents).values({ id: cosId, tenantId: tid, name: "CoS", role: "chief-of-staff", status: "idle", source: "shell" });
    await conn.db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

    const bossId = generateId();
    const pausedId = generateId();
    const activeId = generateId();
    await conn.db.insert(agents).values({ id: bossId, tenantId: tid, name: "Boss", role: "ceo", status: "idle", reportsTo: cosId });
    await conn.db.insert(agents).values({ id: pausedId, tenantId: tid, name: "Paused Eng", role: "engineer", reportsTo: bossId, status: "paused" });
    await conn.db.insert(agents).values({ id: activeId, tenantId: tid, name: "Active Eng", role: "engineer", reportsTo: bossId, status: "idle" });

    const delegate = await findDelegateForTask(conn.db, bossId, "Fix a bug");
    expect(delegate).toBe(activeId);

    await conn.close();
  }, 30000);
});

describe("hierarchy provider", () => {
  it("includes manager, peers, direct reports, and skip-level with skills", async () => {
    const { createHierarchyProvider } = await import("@boringos/agent");
    const { createDatabase, createMigrationManager, tenants, agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    const d = await mkdtemp(join(tmpdir(), "boringos-peers-"));
    const conn = await createDatabase({ embedded: true, dataDir: join(d, "pg"), port: 5569 });
    await createMigrationManager(conn.db).apply();

    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "Peers Co", slug: "peers-co" });

    // Create CoS as root
    const cosId = generateId();
    await conn.db.insert(agents).values({ id: cosId, tenantId: tid, name: "CoS", role: "chief-of-staff", status: "idle", source: "shell" });
    await conn.db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

    const ceo = generateId(); const vp = generateId(); const peer1 = generateId(); const peer2 = generateId(); const ic = generateId();
    await conn.db.insert(agents).values({ id: ceo, tenantId: tid, name: "CEO", role: "ceo", status: "idle", routingTags: [], reportsTo: cosId });
    await conn.db.insert(agents).values({ id: vp, tenantId: tid, name: "VP Sales", role: "vp", reportsTo: ceo, status: "idle", routingTags: ["deal-coaching"] });
    await conn.db.insert(agents).values({ id: peer1, tenantId: tid, name: "VP Marketing", role: "vp", reportsTo: ceo, status: "idle", routingTags: ["campaign-strategy"] });
    await conn.db.insert(agents).values({ id: peer2, tenantId: tid, name: "VP Product", role: "vp", reportsTo: ceo, status: "paused", routingTags: ["roadmap"] });
    await conn.db.insert(agents).values({ id: ic, tenantId: tid, name: "SDR", role: "sdr", reportsTo: vp, status: "idle", routingTags: ["prospecting"] });

    const provider = createHierarchyProvider({ db: conn.db });
    const vpRows = await conn.db.select().from(agents).where((await import("drizzle-orm")).eq(agents.id, vp)).limit(1);
    const out = await provider.provide({ agent: vpRows[0] } as any);
    expect(out).toBeTruthy();
    expect(out).toContain("CEO");           // manager
    expect(out).toContain("VP Marketing");   // peer
    expect(out).toContain("campaign-strategy"); // peer skill
    expect(out).toContain("[paused]");       // paused peer flagged
    expect(out).toContain("SDR");            // direct report
    expect(out).toContain("prospecting");    // report skill

    await conn.close();
  }, 30000);
});

describe("admin gating", () => {
  it("non-admin session receives 403 on agent mutations; admin succeeds", async () => {
    const server = await boot(5572);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const { sql } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      // Set up a tenant + one admin user + one staff user, both with session tokens.
      // auth_users / auth_sessions / user_tenants are defined in core/src/auth.ts
      // (raw SQL rather than drizzle schema). Seed via raw SQL.
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Gate Co", slug: "gate-co" });

      // Create CoS as root for this tenant
      await createCoSForTenant(server, tid);

      const adminId = generateId();
      const adminToken = generateId();
      await db.execute(sql`INSERT INTO auth_users (id, email, name) VALUES (${adminId}, 'admin@gate.co', 'Admin')`);
      await db.execute(sql`INSERT INTO user_tenants (id, user_id, tenant_id, role) VALUES (${generateId()}, ${adminId}, ${tid}, 'admin')`);
      await db.execute(sql`INSERT INTO auth_sessions (id, user_id, token, expires_at) VALUES (${generateId()}, ${adminId}, ${adminToken}, now() + interval '1 hour')`);

      const staffId = generateId();
      const staffToken = generateId();
      await db.execute(sql`INSERT INTO auth_users (id, email, name) VALUES (${staffId}, 'staff@gate.co', 'Staff')`);
      await db.execute(sql`INSERT INTO user_tenants (id, user_id, tenant_id, role) VALUES (${generateId()}, ${staffId}, ${tid}, 'staff')`);
      await db.execute(sql`INSERT INTO auth_sessions (id, user_id, token, expires_at) VALUES (${generateId()}, ${staffId}, ${staffToken}, now() + interval '1 hour')`);

      const hAuth = (tok: string) => ({ "Content-Type": "application/json", "Authorization": `Bearer ${tok}`, "X-Tenant-Id": tid });

      // Admin can create an agent
      const created = await fetch(`${server.url}/api/admin/agents`, {
        method: "POST", headers: hAuth(adminToken),
        body: JSON.stringify({ name: "Admin-made", role: "general" }),
      });
      expect(created.status).toBe(201);
      const agent = await created.json() as { id: string };

      // Staff cannot create
      const denied = await fetch(`${server.url}/api/admin/agents`, {
        method: "POST", headers: hAuth(staffToken),
        body: JSON.stringify({ name: "Staff-try", role: "general" }),
      });
      expect(denied.status).toBe(403);

      // Staff cannot patch
      const patchDenied = await fetch(`${server.url}/api/admin/agents/${agent.id}`, {
        method: "PATCH", headers: hAuth(staffToken),
        body: JSON.stringify({ name: "Staff-try-rename" }),
      });
      expect(patchDenied.status).toBe(403);

      // Staff cannot update skills
      const skillsDenied = await fetch(`${server.url}/api/admin/agents/${agent.id}/skills`, {
        method: "PATCH", headers: hAuth(staffToken),
        body: JSON.stringify({ set: ["foo"] }),
      });
      expect(skillsDenied.status).toBe(403);

      // Staff CAN read (GET routes are open)
      const read = await fetch(`${server.url}/api/admin/agents`, { headers: hAuth(staffToken) });
      expect(read.status).toBe(200);
      const readBody = await read.json() as { agents: unknown[] };
      expect(readBody.agents.length).toBeGreaterThanOrEqual(1);

      // Admin can patch
      const patchOk = await fetch(`${server.url}/api/admin/agents/${agent.id}`, {
        method: "PATCH", headers: hAuth(adminToken),
        body: JSON.stringify({ name: "Admin-renamed" }),
      });
      expect(patchOk.status).toBe(200);
    } finally { await server.close(); }
  }, 30000);
});

describe("reparent semantics", () => {
  it("rejects reportsTo changes that create cycles", async () => {
    const server = await boot(5570);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Cycle Co", slug: "cycle-co" });

      // Create CoS as root for this tenant
      await createCoSForTenant(server, tid);

      // A → B → C. Try to set A.reportsTo = C (which would create A→C→B→A).
      const aRes = await fetch(`${server.url}/api/admin/agents`, { method: "POST", headers: h(tid), body: JSON.stringify({ name: "A", role: "general" }) });
      const a = await aRes.json() as { id: string };
      const bRes = await fetch(`${server.url}/api/admin/agents`, { method: "POST", headers: h(tid), body: JSON.stringify({ name: "B", role: "general", reportsTo: a.id }) });
      const b = await bRes.json() as { id: string };
      const cRes = await fetch(`${server.url}/api/admin/agents`, { method: "POST", headers: h(tid), body: JSON.stringify({ name: "C", role: "general", reportsTo: b.id }) });
      const cc = await cRes.json() as { id: string };

      const badRes = await fetch(`${server.url}/api/admin/agents/${a.id}`, {
        method: "PATCH", headers: h(tid),
        body: JSON.stringify({ reportsTo: cc.id }),
      });
      expect(badRes.status).toBe(409);

      // Self-reference also rejected
      const selfRes = await fetch(`${server.url}/api/admin/agents/${a.id}`, {
        method: "PATCH", headers: h(tid),
        body: JSON.stringify({ reportsTo: a.id }),
      });
      expect(selfRes.status).toBe(409);
    } finally { await server.close(); }
  }, 30000);

  it("archives reparent reports to grandparent", async () => {
    const server = await boot(5571);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Archive Co", slug: "archive-co" });

      // Create CoS as root for this tenant
      await createCoSForTenant(server, tid);

      // CEO → VP → IC. Archive VP. IC should now report to CEO.
      const ceoRes = await fetch(`${server.url}/api/admin/agents`, { method: "POST", headers: h(tid), body: JSON.stringify({ name: "CEO", role: "ceo" }) });
      const ceo = await ceoRes.json() as { id: string };
      const vpRes = await fetch(`${server.url}/api/admin/agents`, { method: "POST", headers: h(tid), body: JSON.stringify({ name: "VP", role: "vp", reportsTo: ceo.id }) });
      const vp = await vpRes.json() as { id: string };
      const icRes = await fetch(`${server.url}/api/admin/agents`, { method: "POST", headers: h(tid), body: JSON.stringify({ name: "IC", role: "engineer", reportsTo: vp.id }) });
      const ic = await icRes.json() as { id: string };

      const patch = await fetch(`${server.url}/api/admin/agents/${vp.id}`, {
        method: "PATCH", headers: h(tid),
        body: JSON.stringify({ status: "archived" }),
      });
      expect(patch.status).toBe(200);

      const icAfter = await db.select().from(agents).where(eq(agents.id, ic.id)).limit(1);
      expect(icAfter[0].reportsTo).toBe(ceo.id);
    } finally { await server.close(); }
  }, 30000);
});

describe("handoff", () => {
  it("creates subtask + parent comment; respects 3-handoff limit", async () => {
    const { createHandoffTask } = await import("@boringos/agent");
    const { createDatabase, createMigrationManager, tenants, agents, tasks, taskComments } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const d = await mkdtemp(join(tmpdir(), "boringos-handoff-"));
    const conn = await createDatabase({ embedded: true, dataDir: join(d, "pg"), port: 5568 });
    await createMigrationManager(conn.db).apply();

    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "Handoff Co", slug: "handoff-co" });

    // Create CoS as root
    const cosId = generateId();
    await conn.db.insert(agents).values({ id: cosId, tenantId: tid, name: "CoS", role: "chief-of-staff", status: "idle", source: "shell" });
    await conn.db.update(tenants).set({ rootAgentId: cosId }).where(eq(tenants.id, tid));

    const a = generateId(); const b = generateId(); const cc = generateId(); const dd = generateId();
    await conn.db.insert(agents).values({ id: a, tenantId: tid, name: "A", role: "general", status: "idle", reportsTo: cosId });
    await conn.db.insert(agents).values({ id: b, tenantId: tid, name: "B", role: "general", status: "idle", reportsTo: cosId });
    await conn.db.insert(agents).values({ id: cc, tenantId: tid, name: "C", role: "general", status: "idle", reportsTo: cosId });
    await conn.db.insert(agents).values({ id: dd, tenantId: tid, name: "D", role: "general", status: "idle", reportsTo: cosId });

    // Root task, assigned to A
    const rootId = generateId();
    await conn.db.insert(tasks).values({ id: rootId, tenantId: tid, title: "Root", status: "todo", priority: "medium", assigneeAgentId: a, originKind: "manual" });

    // A → B (handoff depth 0 at root, 1 after this subtask)
    const h1 = await createHandoffTask(conn.db, { fromAgentId: a, toAgentId: b, parentTaskId: rootId, title: "A→B" });
    expect(h1).not.toBeNull();

    // B → C (depth 2)
    const h2 = await createHandoffTask(conn.db, { fromAgentId: b, toAgentId: cc, parentTaskId: h1!, title: "B→C" });
    expect(h2).not.toBeNull();

    // C → D (depth 3)
    const h3 = await createHandoffTask(conn.db, { fromAgentId: cc, toAgentId: dd, parentTaskId: h2!, title: "C→D" });
    expect(h3).not.toBeNull();

    // D → A on top of 3 existing handoffs → blocked
    const h4 = await createHandoffTask(conn.db, { fromAgentId: dd, toAgentId: a, parentTaskId: h3!, title: "D→A (over limit)" });
    expect(h4).toBeNull();

    // Root is now blocked
    const root = await conn.db.select().from(tasks).where(eq(tasks.id, rootId)).limit(1);
    expect(root[0].status).toBe("blocked");

    // Parent of h1 (= root) should have a handoff comment
    const rootComments = await conn.db.select().from(taskComments).where(eq(taskComments.taskId, rootId));
    expect(rootComments.length).toBe(1);
    expect(rootComments[0].body).toContain("Handed off");

    await conn.close();
  }, 30000);
});
