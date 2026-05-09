// SPDX-License-Identifier: BUSL-1.1
//
// Tiny SSE helper for /api/admin/workflow-runs/:id/events. The backend
// can't read custom Authorization headers from EventSource, so we
// pass the bearer as `?token=`.

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

export function subscribeToRun(
  runId: string,
  token: string | null,
  tenantId: string | undefined,
  onEvent: (e: SSEEvent) => void,
): () => void {
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (tenantId) params.set("tenantId", tenantId);
  const url = `/api/admin/workflow-runs/${runId}/events?${params.toString()}`;
  const es = new EventSource(url);
  const types = [
    "workflow:run_started",
    "workflow:run_completed",
    "workflow:run_failed",
    "workflow:block_started",
    "workflow:block_completed",
    "workflow:block_failed",
    "workflow:block_waiting",
    "workflow:block_skipped",
  ];
  const handlers: Array<{ type: string; fn: (e: MessageEvent) => void }> = [];
  for (const t of types) {
    const fn = (e: MessageEvent) => {
      try {
        onEvent({ type: t, data: JSON.parse(e.data) as Record<string, unknown> });
      } catch {
        // ignore parse errors
      }
    };
    es.addEventListener(t, fn as EventListener);
    handlers.push({ type: t, fn });
  }
  return () => {
    for (const { type, fn } of handlers) es.removeEventListener(type, fn as EventListener);
    es.close();
  };
}
