// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Coverage for the inbox triage path. Two halves:
//
//   1. Forward-sync prefilter — a deterministic header check writes
//      `metadata.email` and (for clearly-automated mail) pre-fills
//      `metadata.triage` with the v2 `noise` label so the LLM agent
//      never runs on a newsletter. Tested at the pure-function level
//      via `buildIngestMetadata`.
//
//   2. `framework.inbox.update` emits `triage.classified` whenever a
//      caller writes a triage block. The replier subscribes to that
//      event in `boringos.ts` and wakes on every emit (no taxonomy /
//      score gate — the replier itself decides skip-vs-draft).
//      Tested by booting the framework module, dispatching the tool,
//      and asserting the event fired + the replier task was queued.

import { describe, it, expect } from "vitest";

import { buildIngestMetadata } from "@boringos/core";

describe("buildIngestMetadata (forward-sync prefilter)", () => {
  it("flags a List-Unsubscribe newsletter and pre-fills metadata.triage", () => {
    const { metadata, automated } = buildIngestMetadata(
      {
        id: "abc",
        from: "Updates <updates@vendor.com>",
        subject: "Weekly digest",
        body: "Body…",
        headers: {
          listUnsubscribe: "<https://vendor.com/unsubscribe?id=abc>",
          listUnsubscribePost: null,
          listId: null,
          autoSubmitted: null,
          precedence: null,
          returnPath: null,
          replyTo: null,
          messageId: null,
          inReplyTo: null,
          references: null,
        },
      },
      { now: new Date("2026-05-09T12:00:00Z") },
    );
    expect(automated.automated).toBe(true);
    expect(automated.kind).toBe("newsletter");
    const email = metadata.email as Record<string, unknown>;
    expect(email).toBeTruthy();
    expect((email.automated as { automated: boolean }).automated).toBe(true);
    const triage = metadata.triage as Record<string, unknown>;
    expect(triage).toBeTruthy();
    expect(triage.label).toBe("noise");
    expect(triage.source).toBe("header-prefilter");
  });

  it("flags noreply@ as automated → noise label", () => {
    const { metadata, automated } = buildIngestMetadata({
      id: "abc",
      from: "noreply@vendor.com",
      subject: "Receipt",
      body: "…",
    });
    expect(automated.automated).toBe(true);
    expect(automated.kind).toBe("automated");
    const triage = metadata.triage as Record<string, unknown> | undefined;
    expect(triage).toBeTruthy();
    expect(triage!.label).toBe("noise");
  });

  it("leaves metadata.triage empty for clearly-human mail", () => {
    const { metadata, automated } = buildIngestMetadata({
      id: "abc",
      from: "Jane <jane@example.com>",
      subject: "RFP follow-up",
      body: "Hey there!",
    });
    expect(automated.automated).toBe(false);
    expect(metadata.triage).toBeUndefined();
    // metadata.email always exists so downstream consumers can rely on it
    expect(metadata.email).toBeDefined();
  });

  it("persists bodyHtml into metadata so the shell's iframe renderer can use it", () => {
    // HTML-only transactional mail (Stripe receipts etc.) ships
    // with no text/plain alternative — the connector returns the
    // HTML in both `body` and `bodyHtml`. The shell renders raw
    // markup as text unless metadata.bodyHtml is populated.
    const html = "<html><body><h1>Payment received</h1><p>$0.00</p></body></html>";
    const { metadata } = buildIngestMetadata({
      id: "abc",
      from: "Stripe <receipts@stripe.com>",
      subject: "Payment Received",
      body: html,
      bodyHtml: html,
    });
    expect(metadata.bodyHtml).toBe(html);
  });

  it("omits bodyHtml when the message was plain-text only", () => {
    const { metadata } = buildIngestMetadata({
      id: "abc",
      from: "jane@example.com",
      subject: "Re: lunch",
      body: "see you at 1",
    });
    expect(metadata.bodyHtml).toBeUndefined();
  });

  it("preserves the headers object on every item", () => {
    const { metadata } = buildIngestMetadata({
      id: "abc",
      from: "jane@example.com",
      subject: "Hi",
      body: "...",
      headers: {
        listUnsubscribe: null,
        listUnsubscribePost: null,
        listId: null,
        autoSubmitted: null,
        precedence: null,
        returnPath: "<bounces+abc@example.com>",
        replyTo: "Jane <jane@example.com>",
        messageId: "<deadbeef@example.com>",
        inReplyTo: null,
        references: null,
      },
    });
    const email = metadata.email as { headers: Record<string, unknown> };
    expect(email.headers.returnPath).toBe("<bounces+abc@example.com>");
    expect(email.headers.replyTo).toBe("Jane <jane@example.com>");
  });
});

describe("framework.inbox.update emits triage.classified", () => {
  it(
    "fires the event when a caller writes metadata.triage; gating handler decides whether to wake replier",
    async () => {
      const { BoringOS, createFrameworkModule } = await import("@boringos/core");
      const { signCallbackToken } = await import("@boringos/agent");
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const dataDir = await mkdtemp(join(tmpdir(), "boringos-triage-gate-"));
      const jwtSecret = "triage-gate-secret";

      const app = new BoringOS({
        database: { embedded: true, dataDir, port: 5573 },
        drive: { root: join(dataDir, "drive") },
        auth: { secret: jwtSecret },
      });
      app.module(createFrameworkModule);

      const seenEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
      app.onEvent("triage.classified", (event) => {
        seenEvents.push({ type: event.type, data: event.data });
      });

      const server = await app.listen(0);
      try {
        const { tenants, agents, agentRuns, inboxItems } = await import("@boringos/db");
        const { generateId } = await import("@boringos/shared");
        const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
        const tenantId = "3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a";
        const agentId = "3b3b3b3b-3b3b-43b3-83b3-3b3b3b3b3b3b";
        const runId = "3c3c3c3c-3c3c-43c3-83c3-3c3c3c3c3c3c";

        await db
          .insert(tenants)
          .values({ id: tenantId, name: "Triage Gate", slug: "triage-gate" })
          .onConflictDoNothing();
        await db
          .insert(agents)
          .values({ id: agentId, tenantId, name: "Triage Gate Agent", role: "general" })
          .onConflictDoNothing();
        await db
          .insert(agentRuns)
          .values({ id: runId, tenantId, agentId, status: "running" })
          .onConflictDoNothing();

        const itemId = generateId();
        await db.insert(inboxItems).values({
          id: itemId,
          tenantId,
          source: "google.gmail",
          subject: "Hello",
          body: "Body",
          from: "jane@example.com",
          status: "unread",
          metadata: {
            email: {
              headers: {},
              automated: { automated: false, kind: null, reasons: [] },
            },
          },
        });

        const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

        // Call framework.inbox.update with a triage block. The
        // important assertion isn't the response shape (already
        // covered by v2-parity); it's that subscribers see the
        // event.
        const res = await fetch(`${server.url}/api/tools/framework.inbox.update`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            itemId,
            metadata: {
              email: {
                headers: {},
                automated: { automated: false, kind: null, reasons: [] },
              },
              triage: {
                label: "important",
                rationale: "vendor with stated value",
                classifiedAt: new Date().toISOString(),
                source: "agent",
              },
            },
          }),
        });
        const body = (await res.json()) as { ok: boolean };
        expect(body.ok).toBe(true);

        // Event handlers run synchronously in the in-process bus;
        // by the time the HTTP response returned, our subscriber
        // should already have observed the event.
        expect(seenEvents.length).toBe(1);
        const evt = seenEvents[0];
        expect(evt.type).toBe("triage.classified");
        expect(evt.data.itemId).toBe(itemId);
        expect(evt.data.label).toBe("important");
        expect(evt.data.source).toBe("agent");
      } finally {
        await server.close();
      }
    },
    180_000,
  );

  it(
    "wakes the replier ONLY for non-noise/fyi triage.classified events (RC1 workflow gate)",
    async () => {
      const { BoringOS, createFrameworkModule, createWorkflowModule } =
        await import("@boringos/core");
      const { signCallbackToken } = await import("@boringos/agent");
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const dataDir = await mkdtemp(join(tmpdir(), "boringos-replier-gate-"));
      const jwtSecret = "replier-gate-secret";

      const app = new BoringOS({
        database: { embedded: true, dataDir, port: 5575 },
        drive: { root: join(dataDir, "drive") },
        auth: { secret: jwtSecret },
        // Pause every agent globally so the test never spawns the
        // CLI runtime for newly-woken runs. We're asserting the
        // _decision_ (was a wake recorded? was a task created?),
        // not the runtime side effects.
      });
      app.module(createFrameworkModule);
      // RC1: the replier wake path now flows through the workflow
      // dispatcher, which calls the `workflow.run` tool — so the
      // workflow module must be registered for this test.
      app.module(createWorkflowModule);

      const server = await app.listen(0);
      try {
        const { tenants, agents, agentRuns, inboxItems, tasks: tasksTable, tenantSettings } =
          await import("@boringos/db");
        const { generateId } = await import("@boringos/shared");
        const { eq } = await import("drizzle-orm");
        const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
        const tenantId = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
        const triageAgentId = "5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b";
        const replierAgentId = "5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c5c";
        const runId = "5d5d5d5d-5d5d-45d5-85d5-5d5d5d5d5d5d";

        await db
          .insert(tenants)
          .values({ id: tenantId, name: "Replier Gate", slug: "replier-gate" })
          .onConflictDoNothing();
        // The framework looks up agents by name — these names are
        // the canonical ones the default-app catalog seeds them
        // under. We seed them directly so we don't need to install
        // the actual default apps in this test.
        // Schema constraint: one agent per tenant may have
        // `reports_to IS NULL` (the partial unique index
        // `agents_tenant_one_root_idx`). Make the triage agent the
        // root and have the replier report to it so both inserts
        // succeed.
        await db
          .insert(agents)
          .values({
            id: triageAgentId,
            tenantId,
            name: "Generic Inbox Triage",
            role: "general",
          })
          .onConflictDoNothing();
        await db
          .insert(agents)
          .values({
            id: replierAgentId,
            tenantId,
            name: "Generic Email Replier",
            role: "general",
            reportsTo: triageAgentId,
          })
          .onConflictDoNothing();
        await db
          .insert(agentRuns)
          .values({ id: runId, tenantId, agentId: triageAgentId, status: "running" })
          .onConflictDoNothing();

        // RC1: the replier wake path is now the inbox-replier
        // workflow, which triggers on `triage.classified`. The
        // module's onInstall would seed this row in production —
        // we insert it directly so the test doesn't depend on the
        // full module install pipeline.
        const { workflows: workflowsTable } = await import("@boringos/db");
        const { buildReplierWorkflowBlocks } = await import(
          "../packages/@boringos/core/src/modules/inbox-replier.js"
        );
        const { blocks: replierBlocks, edges: replierEdges } =
          buildReplierWorkflowBlocks(replierAgentId);
        await db.insert(workflowsTable).values({
          id: generateId(),
          tenantId,
          name: "Draft generic reply for incoming items",
          type: "system",
          status: "active",
          blocks: replierBlocks,
          edges: replierEdges,
        });

        // Pause both agents globally so we don't actually spawn the
        // CLI subprocess when the engine queues a wake. This test
        // asserts orchestration decisions (task created? for which
        // agent?), not runtime behaviour.
        await db
          .insert(tenantSettings)
          .values({ tenantId, key: "agents_paused", value: "true" })
          .onConflictDoNothing();

        const seedItem = async (): Promise<string> => {
          const id = generateId();
          await db.insert(inboxItems).values({
            id,
            tenantId,
            source: "google.gmail",
            subject: "Subject",
            body: "Body",
            from: "jane@example.com",
            status: "unread",
            metadata: {
              email: {
                headers: {},
                automated: { automated: false, kind: null, reasons: [] },
              },
            },
          });
          return id;
        };

        const token = signCallbackToken(
          { runId, agentId: triageAgentId, tenantId },
          jwtSecret,
        );
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

        const writeTriage = async (
          itemId: string,
          triage: Record<string, unknown>,
        ) => {
          await fetch(`${server.url}/api/tools/framework.inbox.update`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              itemId,
              metadata: {
                email: {
                  headers: {},
                  automated: { automated: false, kind: null, reasons: [] },
                },
                triage,
              },
            }),
          });
        };

        const replierTaskCount = async (originId: string) => {
          const rows = await db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.originId, originId));
          return rows.filter((r) => r.assigneeAgentId === replierAgentId).length;
        };


        // Wait for the gating handler's async wake/task path to
        // complete. The event handler is fire-and-forget; the bus
        // returns after its `await`s settle, but the workflow
        // dispatcher path includes several dynamic imports + a
        // dispatch chain through workflow.run → runWorkflowDag →
        // framework.tasks.create that extends the microtask chain
        // a few ticks longer than awaiting the bus alone covers.
        const flush = () => new Promise((r) => setTimeout(r, 500));

        // RC1: noise/fyi are filtered at the workflow condition
        // blocks before the task block runs. The replier only wakes
        // for urgent/important items. This is the "gate at the
        // workflow trigger" model — replaces the previous "no gate,
        // replier decides" listener path.

        // Case 1 — noise label: condition `label != noise` fails,
        // workflow stops, NO replier task created.
        const item1 = await seedItem();
        await writeTriage(item1, {
          label: "noise",
          rationale: "footer says unsubscribe",
          classifiedAt: new Date().toISOString(),
          source: "agent",
        });
        await flush();
        expect(await replierTaskCount(item1)).toBe(0);

        // Case 2 — fyi label: condition `label != fyi` fails,
        // workflow stops, NO replier task created.
        const item2 = await seedItem();
        await writeTriage(item2, {
          label: "fyi",
          rationale: "informational",
          classifiedAt: new Date().toISOString(),
          source: "agent",
        });
        await flush();
        expect(await replierTaskCount(item2)).toBe(0);

        // Case 3 — header-prefilter source classified as noise:
        // also filtered by the workflow condition.
        const item3 = await seedItem();
        await writeTriage(item3, {
          label: "noise",
          rationale: "prefilter",
          classifiedAt: new Date().toISOString(),
          source: "header-prefilter",
        });
        await flush();
        expect(await replierTaskCount(item3)).toBe(0);

        // Case 4 — important: both conditions pass, task block
        // fires, replier task created.
        const item4 = await seedItem();
        await writeTriage(item4, {
          label: "important",
          rationale: "vendor with stated value",
          classifiedAt: new Date().toISOString(),
          source: "agent",
        });
        await flush();
        expect(await replierTaskCount(item4)).toBe(1);
      } finally {
        await server.close();
      }
    },
    180_000,
  );

  it(
    "does NOT re-emit when the same triage block is patched again",
    async () => {
      const { BoringOS, createFrameworkModule } = await import("@boringos/core");
      const { signCallbackToken } = await import("@boringos/agent");
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const dataDir = await mkdtemp(join(tmpdir(), "boringos-triage-noop-"));
      const jwtSecret = "triage-gate-secret-2";

      const app = new BoringOS({
        database: { embedded: true, dataDir, port: 5574 },
        drive: { root: join(dataDir, "drive") },
        auth: { secret: jwtSecret },
      });
      app.module(createFrameworkModule);

      const seen: Array<Record<string, unknown>> = [];
      app.onEvent("triage.classified", (event) => {
        seen.push(event.data);
      });

      const server = await app.listen(0);
      try {
        const { tenants, agents, agentRuns, inboxItems } = await import("@boringos/db");
        const { generateId } = await import("@boringos/shared");
        const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
        const tenantId = "4a4a4a4a-4a4a-44a4-84a4-4a4a4a4a4a4a";
        const agentId = "4b4b4b4b-4b4b-44b4-84b4-4b4b4b4b4b4b";
        const runId = "4c4c4c4c-4c4c-44c4-84c4-4c4c4c4c4c4c";

        await db
          .insert(tenants)
          .values({ id: tenantId, name: "Noop", slug: "noop" })
          .onConflictDoNothing();
        await db
          .insert(agents)
          .values({ id: agentId, tenantId, name: "Noop Agent", role: "general" })
          .onConflictDoNothing();
        await db
          .insert(agentRuns)
          .values({ id: runId, tenantId, agentId, status: "running" })
          .onConflictDoNothing();

        const itemId = generateId();
        await db.insert(inboxItems).values({
          id: itemId,
          tenantId,
          source: "google.gmail",
          subject: "Hi",
          body: "...",
          from: "jane@example.com",
          status: "unread",
        });

        const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

        const triageBlock = {
          label: "important",
          rationale: "same domain",
          classifiedAt: new Date().toISOString(),
          source: "agent",
        };

        const fire = async () => {
          await fetch(`${server.url}/api/tools/framework.inbox.update`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              itemId,
              metadata: { triage: triageBlock },
            }),
          });
        };
        await fire();
        await fire();

        expect(seen.length).toBe(1);
      } finally {
        await server.close();
      }
    },
    180_000,
  );
});
