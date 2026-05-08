// SPDX-License-Identifier: MIT
//
// `hebbs-crm` Module — the v2 CRM port. Hybrid module: owns its
// own schema (`hebbs_crm__*` tables), exposes business-logic
// tools (deals / contacts / pipelines), ships a SKILL.md
// teaching the model.
//
// Phase 8 of task_12. UI screens, default workflows, default
// agents are deferred to follow-on chunks; this skeleton ships
// the schema + tools + skill so an agent can manipulate the CRM
// data through `/api/tools/hebbs-crm.*`.

import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  hebbsCrmPipelines,
  hebbsCrmContacts,
  hebbsCrmDeals,
  hebbsCrmActivities,
} from "@boringos/db";
import { generateId } from "@boringos/shared";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const CRM_SKILL = `Hebbs CRM tracks customer relationships through deals,
contacts, and pipelines.

Model:
- A **pipeline** is an ordered list of stages (e.g. New → Qualified →
  Demo → Proposal → Closed-Won / Closed-Lost). Tenants typically have
  one default pipeline; some have multiple for different sales motions.
- A **deal** moves through a pipeline's stages. Each deal has an amount
  (cents), currency, optional close date, and optional contact link.
- A **contact** is a person (name + email + company + title). One
  contact can be linked to many deals.
- An **activity** is a timeline event: deal created, stage changed,
  note added, call logged. Use this to give the human a record of what
  happened.

Tools:
- \`hebbs-crm.list_deals(stageId?, pipelineId?, limit?)\` — list deals,
  optionally filtered by stage or pipeline
- \`hebbs-crm.create_deal(title, amountCents, pipelineId, stageId, contactId?)\` —
  create a deal at a specific stage
- \`hebbs-crm.move_stage(dealId, stageId, note?)\` — advance / regress a
  deal; logs an activity row automatically
- \`hebbs-crm.list_contacts(limit?)\` — list contacts
- \`hebbs-crm.create_contact(name, email?, company?, title?)\` — add a
  contact
- \`hebbs-crm.list_pipelines()\` — see what pipelines + stages exist

Conventions:
- Don't move deals to closed-won or closed-lost without explicit
  approval (the approvals skill applies).
- When logging a call or meeting, prefer adding an activity row over
  putting it in deal notes.
- Stage IDs are stable strings within a pipeline's stages array — read
  them via \`list_pipelines\` first if you don't know the right id.`;

interface CrmDeps {
  db: Db;
}

function makeListDeals(deps: CrmDeps): Tool {
  return {
    name: "list_deals",
    description: "List deals, optionally filtered by stage or pipeline",
    inputs: z.object({
      stageId: z.string().optional(),
      pipelineId: z.string().uuid().optional(),
      limit: z.number().int().positive().optional(),
    }),
    async handler(
      input: { stageId?: string; pipelineId?: string; limit?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      let where = eq(hebbsCrmDeals.tenantId, ctx.tenantId);
      if (input.stageId) {
        where = and(where, eq(hebbsCrmDeals.stageId, input.stageId))!;
      }
      if (input.pipelineId) {
        where = and(where, eq(hebbsCrmDeals.pipelineId, input.pipelineId))!;
      }
      const rows = await deps.db
        .select()
        .from(hebbsCrmDeals)
        .where(where)
        .orderBy(desc(hebbsCrmDeals.createdAt))
        .limit(input.limit ?? 50);
      return { ok: true, result: { deals: rows } };
    },
  };
}

function makeCreateDeal(deps: CrmDeps): Tool {
  return {
    name: "create_deal",
    description: "Create a deal at a specific pipeline stage",
    inputs: z.object({
      title: z.string(),
      amountCents: z.number().int().nonnegative(),
      currency: z.string().optional(),
      pipelineId: z.string().uuid(),
      stageId: z.string(),
      contactId: z.string().uuid().optional(),
      expectedCloseDate: z.string().optional(),
      notes: z.string().optional(),
    }),
    async handler(
      input: {
        title: string;
        amountCents: number;
        currency?: string;
        pipelineId: string;
        stageId: string;
        contactId?: string;
        expectedCloseDate?: string;
        notes?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      await deps.db.insert(hebbsCrmDeals).values({
        id,
        tenantId: ctx.tenantId,
        title: input.title,
        amountCents: input.amountCents,
        currency: input.currency ?? "USD",
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        contactId: input.contactId,
        expectedCloseDate: input.expectedCloseDate
          ? new Date(input.expectedCloseDate)
          : undefined,
        notes: input.notes,
      });
      await deps.db.insert(hebbsCrmActivities).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        entityKind: "deal",
        entityId: id,
        action: "created",
        payload: { stageId: input.stageId, amountCents: input.amountCents },
        actorAgentId: ctx.agentId,
      });
      return { ok: true, result: { dealId: id } };
    },
  };
}

function makeMoveStage(deps: CrmDeps): Tool {
  return {
    name: "move_stage",
    description: "Move a deal to a new stage and log a stage_changed activity",
    inputs: z.object({
      dealId: z.string().uuid(),
      stageId: z.string(),
      note: z.string().optional(),
    }),
    async handler(
      input: { dealId: string; stageId: string; note?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await deps.db
        .select()
        .from(hebbsCrmDeals)
        .where(eq(hebbsCrmDeals.id, input.dealId))
        .limit(1);
      const deal = rows[0];
      if (!deal || deal.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Deal not found", retryable: false },
        };
      }
      const fromStageId = deal.stageId;
      await deps.db
        .update(hebbsCrmDeals)
        .set({ stageId: input.stageId, updatedAt: new Date() })
        .where(eq(hebbsCrmDeals.id, input.dealId));
      await deps.db.insert(hebbsCrmActivities).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        entityKind: "deal",
        entityId: input.dealId,
        action: "stage_changed",
        payload: { from: fromStageId, to: input.stageId, note: input.note },
        actorAgentId: ctx.agentId,
      });
      return { ok: true, result: { ok: true, from: fromStageId, to: input.stageId } };
    },
  };
}

function makeListContacts(deps: CrmDeps): Tool {
  return {
    name: "list_contacts",
    description: "List contacts for the current tenant",
    inputs: z.object({ limit: z.number().int().positive().optional() }),
    async handler(input: { limit?: number }, ctx: ToolContext): Promise<ToolResult> {
      const rows = await deps.db
        .select()
        .from(hebbsCrmContacts)
        .where(eq(hebbsCrmContacts.tenantId, ctx.tenantId))
        .orderBy(desc(hebbsCrmContacts.createdAt))
        .limit(input.limit ?? 50);
      return { ok: true, result: { contacts: rows } };
    },
  };
}

function makeCreateContact(deps: CrmDeps): Tool {
  return {
    name: "create_contact",
    description: "Add a new contact",
    inputs: z.object({
      name: z.string(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      title: z.string().optional(),
      notes: z.string().optional(),
    }),
    async handler(
      input: {
        name: string;
        email?: string;
        phone?: string;
        company?: string;
        title?: string;
        notes?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      await deps.db.insert(hebbsCrmContacts).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        company: input.company,
        title: input.title,
        notes: input.notes,
      });
      await deps.db.insert(hebbsCrmActivities).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        entityKind: "contact",
        entityId: id,
        action: "created",
        payload: { name: input.name, email: input.email },
        actorAgentId: ctx.agentId,
      });
      return { ok: true, result: { contactId: id } };
    },
  };
}

function makeListPipelines(deps: CrmDeps): Tool {
  return {
    name: "list_pipelines",
    description: "List pipelines and their stages",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const rows = await deps.db
        .select()
        .from(hebbsCrmPipelines)
        .where(eq(hebbsCrmPipelines.tenantId, ctx.tenantId));
      return { ok: true, result: { pipelines: rows } };
    },
  };
}

export const createHebbsCrmModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  const crmDeps: CrmDeps = { db };

  const module: Module = {
    id: "hebbs-crm",
    name: "Hebbs CRM",
    version: "0.1.0",
    description:
      "Customer relationship management — deals, contacts, pipelines, activities",
    provides: ["crm-source", "crm-actions"],
    dependsOn: [{ capability: "email-send", optional: true }],
    skills: [
      {
        id: "hebbs-crm",
        source: "module",
        body: CRM_SKILL,
        priority: 90,
      },
    ],
    tools: [
      makeListDeals(crmDeps),
      makeCreateDeal(crmDeps),
      makeMoveStage(crmDeps),
      makeListContacts(crmDeps),
      makeCreateContact(crmDeps),
      makeListPipelines(crmDeps),
    ],
  };

  return module;
};
