// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin fetch wrappers around /api/admin/workflows + /api/admin/*.
// Centralised so the editor doesn't sprinkle URLs everywhere.

import { authHeaders } from "./utils.js";
import type {
  ModuleRow,
  ToolRow,
  AgentRow,
  EventTypeRow,
  Block,
  Edge,
  WorkflowSummary,
  BlockRun,
} from "./types.js";

interface Auth {
  token: string | null;
  tenantId: string | undefined;
}

export async function listWorkflows(a: Auth): Promise<WorkflowSummary[]> {
  const res = await fetch("/api/admin/workflows", { headers: authHeaders(a.token, a.tenantId) });
  if (!res.ok) throw new Error(`workflows: ${res.status}`);
  const body = await res.json();
  if (Array.isArray(body)) return body as WorkflowSummary[];
  return (body?.workflows ?? []) as WorkflowSummary[];
}

export async function createWorkflow(a: Auth, init: Partial<WorkflowSummary>): Promise<WorkflowSummary> {
  const res = await fetch("/api/admin/workflows", {
    method: "POST",
    headers: authHeaders(a.token, a.tenantId),
    body: JSON.stringify(init),
  });
  if (!res.ok) throw new Error(`create: ${res.status}`);
  return (await res.json()) as WorkflowSummary;
}

export async function patchWorkflow(
  a: Auth,
  id: string,
  patch: Partial<{
    name: string;
    status: string;
    blocks: Block[];
    edges: Edge[];
    governingAgentId: string | null;
  }>,
): Promise<WorkflowSummary> {
  const res = await fetch(`/api/admin/workflows/${id}`, {
    method: "PATCH",
    headers: authHeaders(a.token, a.tenantId),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`save: ${res.status}`);
  return (await res.json()) as WorkflowSummary;
}

export async function deleteWorkflow(a: Auth, id: string): Promise<void> {
  const res = await fetch(`/api/admin/workflows/${id}`, {
    method: "DELETE",
    headers: authHeaders(a.token, a.tenantId),
  });
  if (!res.ok) throw new Error(`delete: ${res.status}`);
}

export async function duplicateWorkflow(a: Auth, src: WorkflowSummary): Promise<WorkflowSummary> {
  return createWorkflow(a, {
    name: `${src.name} (copy)`,
    blocks: src.blocks ?? [],
    edges: src.edges ?? [],
  });
}

export async function runWorkflow(
  a: Auth,
  id: string,
  payload?: Record<string, unknown>,
): Promise<{ runId?: string; status?: string; error?: string }> {
  const res = await fetch(`/api/admin/workflows/${id}/run`, {
    method: "POST",
    headers: authHeaders(a.token, a.tenantId),
    body: JSON.stringify({ payload: payload ?? {} }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) throw new Error(body?.error ?? `run: ${res.status}`);
  return body;
}

export async function listTools(a: Auth): Promise<ToolRow[]> {
  const res = await fetch("/api/admin/tools", { headers: authHeaders(a.token, a.tenantId) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`tools: ${res.status}`);
  const body = (await res.json()) as { tools: ToolRow[] };
  return body.tools ?? [];
}

export async function listAgents(a: Auth): Promise<AgentRow[]> {
  const res = await fetch("/api/admin/agents", { headers: authHeaders(a.token, a.tenantId) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`agents: ${res.status}`);
  const body = (await res.json()) as { agents: AgentRow[] };
  return body.agents ?? [];
}

export async function listEventTypes(a: Auth): Promise<EventTypeRow[]> {
  const res = await fetch("/api/admin/event-types", { headers: authHeaders(a.token, a.tenantId) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`event-types: ${res.status}`);
  const body = (await res.json()) as { eventTypes: EventTypeRow[] };
  return body.eventTypes ?? [];
}

export async function listModules(a: Auth): Promise<ModuleRow[]> {
  const res = await fetch("/api/admin/modules", { headers: authHeaders(a.token, a.tenantId) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`modules: ${res.status}`);
  const body = (await res.json()) as { modules: ModuleRow[] };
  return body.modules ?? [];
}

export interface RunDetail {
  run: {
    id: string;
    workflowId: string;
    status: string;
    triggerType?: string;
    triggerPayload?: Record<string, unknown> | null;
    error?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    durationMs?: number | null;
  };
  blocks: BlockRun[];
}

export async function getRun(a: Auth, runId: string): Promise<RunDetail> {
  const res = await fetch(`/api/admin/workflow-runs/${runId}`, {
    headers: authHeaders(a.token, a.tenantId),
  });
  if (!res.ok) throw new Error(`run: ${res.status}`);
  const body = (await res.json()) as { run: RunDetail["run"]; blocks: unknown[] };
  return {
    run: body.run,
    blocks: (body.blocks ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        blockId: String(r.blockId ?? ""),
        status: (r.status as BlockRun["status"]) ?? "pending",
        durationMs: (r.durationMs as number | null) ?? null,
        error: (r.error as string | null) ?? null,
        output: (r.output as Record<string, unknown> | null) ?? null,
        resolvedConfig: (r.resolvedConfig as Record<string, unknown> | null) ?? null,
        inputContext: (r.inputContext as Record<string, unknown> | null) ?? null,
      };
    }),
  };
}

export async function forkRun(
  a: Auth,
  runId: string,
  fromBlockId: string,
  editedInputs?: Record<string, unknown>,
): Promise<{ runId: string; forkedFromRunId: string }> {
  const res = await fetch(`/api/admin/workflow-runs/${runId}/fork`, {
    method: "POST",
    headers: authHeaders(a.token, a.tenantId),
    body: JSON.stringify({ fromBlockId, editedInputs }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `fork: ${res.status}`);
  }
  return (await res.json()) as { runId: string; forkedFromRunId: string };
}

export async function replayRun(a: Auth, runId: string): Promise<{ runId: string }> {
  const res = await fetch(`/api/admin/workflow-runs/${runId}/replay`, {
    method: "POST",
    headers: authHeaders(a.token, a.tenantId),
  });
  if (!res.ok) throw new Error(`replay: ${res.status}`);
  return (await res.json()) as { runId: string };
}

export async function listRuns(a: Auth, workflowId: string, limit = 25): Promise<RunDetail["run"][]> {
  const res = await fetch(`/api/admin/workflows/${workflowId}/runs?limit=${limit}`, {
    headers: authHeaders(a.token, a.tenantId),
  });
  if (!res.ok) throw new Error(`runs: ${res.status}`);
  const body = (await res.json()) as { runs: RunDetail["run"][] };
  return body.runs ?? [];
}
