import type {
  Agent,
  Task,
  TaskComment,
  AgentRun,
} from "@boringos/shared";

// ── Client config ────────────────────────────────────────────────────────────

export interface BoringOSClientConfig {
  url: string;
  apiKey?: string;
  tenantId?: string;
  token?: string;  // legacy callback JWT — prefer apiKey for admin access
}

// ── Response types ───────────────────────────────────────────────────────────

export interface TaskWithComments {
  task: Task;
  comments: TaskComment[];
}

export interface ConnectorInfo {
  kind: string;
  name: string;
  description: string;
  events: Array<{ type: string; description: string }>;
  actions: Array<{ name: string; description: string }>;
  hasOAuth: boolean;
}

export interface WorkflowInfo {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  status: string;
  blocks: unknown[];
  edges: unknown[];
}

export interface HealthStatus {
  status: string;
  timestamp: string;
}

// ── The client ───────────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  tenantId: string;
  source: string;
  sourceId?: string | null;
  subject: string;
  body?: string | null;
  from?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  linkedTaskId?: string | null;
  archivedAt?: string | null;
  snoozeUntil?: string | null;
  createdAt: string;
  updatedAt: string;
  assigneeUserId?: string | null;
}

export interface RuntimeModel {
  id: string;
  label: string;
}

export interface BoringOSClient {
  /**
   * Read-only snapshot of the config used to construct this client.
   * Screens that bypass the typed methods (direct fetch to admin
   * endpoints) read `config.token` / `config.tenantId` / `config.url`
   * to compose their own auth headers. Mutating this does not
   * reconfigure the client; create a new one if you need new auth.
   */
  readonly config: Readonly<BoringOSClientConfig>;

  // Health
  health(): Promise<HealthStatus>;

  // Settings
  getSettings(): Promise<Record<string, string | null>>;
  updateSettings(data: Record<string, unknown>): Promise<Record<string, string | null>>;

  // Tenants
  createTenant(data: { name: string; slug: string }): Promise<Record<string, unknown>>;
  getCurrentTenant(): Promise<Record<string, unknown>>;

  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent>;
  createAgent(data: { name: string; role?: string; instructions?: string; runtimeId?: string }): Promise<Agent>;
  updateAgent(agentId: string, data: { name?: string; role?: string; instructions?: string; status?: string; runtimeId?: string; fallbackRuntimeId?: string }): Promise<Agent>;
  wakeAgent(agentId: string, taskId?: string): Promise<Record<string, unknown>>;
  getAgentRuns(agentId: string): Promise<AgentRun[]>;

  // Tasks
  getTasks(filters?: { status?: string; assigneeAgentId?: string }): Promise<Task[]>;
  getTask(taskId: string): Promise<TaskWithComments>;
  createTask(data: {
    title: string;
    description?: string;
    priority?: string;
    assigneeAgentId?: string;
    assigneeUserId?: string;
    parentId?: string;
    originKind?: string;
    proposedParams?: Record<string, unknown>;
  }): Promise<Task>;
  updateTask(taskId: string, data: { status?: string; title?: string; description?: string; priority?: string; assigneeAgentId?: string }): Promise<Task>;
  deleteTask(taskId: string): Promise<void>;
  postComment(taskId: string, data: { body: string }): Promise<{ id: string }>;
  assignTask(taskId: string, agentId: string, wake?: boolean): Promise<Record<string, unknown>>;
  /**
   * Human's "Send back to agent" — flips next_actor='agent' and wakes the
   * assigned agent. Optional comment is posted before the wake so the
   * agent reads it on next pass.
   */
  sendTaskToAgent(taskId: string, comment?: string): Promise<{ ok: true; wakeOutcome: { kind: string } }>;
  /**
   * Human's "Mark done" — closes the task. The DB trigger nulls
   * next_actor automatically. Optional closing comment.
   */
  markTaskDone(taskId: string, comment?: string): Promise<{ ok: true }>;
  /**
   * Approve or reject an agent-action task. The optional comment is
   * posted on the PARENT task (where the requesting agent's session
   * lives) and auto-wakes that agent.
   */
  decideTask(
    taskId: string,
    kind: "approve" | "reject",
    comment?: string,
  ): Promise<{ ok: true; decision: string; parentWokenForAgentId: string | null }>;
  addWorkProduct(taskId: string, data: { kind: string; title: string; url?: string }): Promise<{ id: string }>;

  // Runs
  getRuns(filters?: { agentId?: string; status?: string }): Promise<AgentRun[]>;
  getRun(runId: string): Promise<AgentRun>;
  cancelRun(runId: string): Promise<void>;

  // Runtimes
  getRuntimes(): Promise<Record<string, unknown>[]>;
  createRuntime(data: { name: string; type: string; config?: Record<string, unknown>; model?: string }): Promise<Record<string, unknown>>;
  updateRuntime(runtimeId: string, data: { name?: string; config?: Record<string, unknown>; model?: string }): Promise<Record<string, unknown>>;
  deleteRuntime(runtimeId: string): Promise<void>;
  setDefaultRuntime(runtimeId: string): Promise<void>;
  getRuntimeModels(runtimeId: string): Promise<RuntimeModel[]>;

  // Approvals — collapsed into tasks (see decideTask above; tasks
  // with origin_kind="agent_action" carry the decision affordance).

  // Routines
  getRoutines(): Promise<Record<string, unknown>[]>;
  createRoutine(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateRoutine(routineId: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteRoutine(routineId: string): Promise<void>;
  triggerRoutine(routineId: string): Promise<Record<string, unknown>>;

  // Workflows
  getWorkflows(): Promise<Record<string, unknown>[]>;
  getWorkflow(workflowId: string): Promise<Record<string, unknown>>;
  createWorkflow(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateWorkflow(workflowId: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteWorkflow(workflowId: string): Promise<void>;
  getWorkflowRuns(workflowId: string): Promise<Record<string, unknown>[]>;

  // Budgets
  getBudgets(): Promise<Record<string, unknown>[]>;
  createBudget(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteBudget(budgetId: string): Promise<void>;
  getBudgetIncidents(): Promise<Record<string, unknown>[]>;

  // Cost
  getCosts(): Promise<Record<string, unknown>[]>;
  reportCost(runId: string, data: { inputTokens: number; outputTokens: number; model?: string; costUsd?: number }): Promise<void>;

  // Connectors
  getConnectors(): Promise<ConnectorInfo[]>;
  invokeAction(kind: string, action: string, inputs: Record<string, unknown>): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;

  // Inbox
  getInbox(filters?: { status?: string; limit?: number }): Promise<InboxItem[]>;
  getInboxItem(itemId: string): Promise<InboxItem>;
  archiveInboxItem(itemId: string): Promise<void>;
  updateInboxItem(
    itemId: string,
    data: {
      status?: string;
      metadata?: Record<string, unknown>;
      assigneeUserId?: string | null;
      snoozeUntil?: string | null;
    },
  ): Promise<InboxItem>;
  createTaskFromInboxItem(itemId: string, data?: { title?: string; description?: string }): Promise<{ taskId: string }>;

  // Realtime
  subscribe(onEvent: (event: { type: string; data: Record<string, unknown> }) => void): () => void;
}

export function createBoringOSClient(config: BoringOSClientConfig): BoringOSClient {
  const baseUrl = config.url.replace(/\/$/, "");

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) h["X-API-Key"] = config.apiKey;
    if (config.tenantId) h["X-Tenant-Id"] = config.tenantId;
    if (config.token) h["Authorization"] = `Bearer ${config.token}`;
    return h;
  }

  // The shell + admin clients only ever talk to /api/admin.
  // Agent-side callers use /api/tools/* directly (the v2 tool
  // dispatch surface) and do not go through this client.
  const api = "/api/admin";

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { headers: headers() });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function patch<T = void>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function del(path: string): Promise<void> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  }

  return {
    config,
    health: () => get<HealthStatus>("/health"),

    // Settings
    getSettings: async () => {
      const res = await get<{ settings: Record<string, string | null> }>(`${api}/settings`);
      return res.settings;
    },
    updateSettings: async (data) => {
      const res = await patch<{ settings: Record<string, string | null> }>(`${api}/settings`, data);
      return res.settings;
    },

    // Tenants
    createTenant: (data) => post<Record<string, unknown>>(`${api}/tenants`, data),
    getCurrentTenant: () => get<Record<string, unknown>>(`${api}/tenants/current`),

    // Agents
    getAgents: async () => {
      const res = await get<{ agents: Agent[] }>(`${api}/agents`);
      return res.agents;
    },
    getAgent: (agentId) => get<Agent>(`${api}/agents/${agentId}`),
    createAgent: (data) => post<Agent>(`${api}/agents`, data),
    updateAgent: (agentId, data) => patch<Agent>(`${api}/agents/${agentId}`, data),
    wakeAgent: (agentId, taskId?) => post<Record<string, unknown>>(`${api}/agents/${agentId}/wake`, { taskId }),
    getAgentRuns: async (agentId) => {
      const res = await get<{ runs: AgentRun[] }>(`${api}/agents/${agentId}/runs`);
      return res.runs;
    },

    // Tasks
    getTasks: async (filters?) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.assigneeAgentId) params.set("assigneeAgentId", filters.assigneeAgentId);
      const qs = params.toString();
      const res = await get<{ tasks: Task[] }>(`${api}/tasks${qs ? `?${qs}` : ""}`);
      return res.tasks;
    },
    getTask: (taskId) => get<TaskWithComments>(`${api}/tasks/${taskId}`),
    createTask: (data) => post<Task>(`${api}/tasks`, data),
    updateTask: (taskId, data) => patch<Task>(`${api}/tasks/${taskId}`, data),
    deleteTask: (taskId) => del(`${api}/tasks/${taskId}`),
    postComment: (taskId, data) => post<{ id: string }>(`${api}/tasks/${taskId}/comments`, data),
    assignTask: (taskId, agentId, wake?) => post<Record<string, unknown>>(`${api}/tasks/${taskId}/assign`, { agentId, wake }),
    sendTaskToAgent: (taskId, comment?) =>
      post<{ ok: true; wakeOutcome: { kind: string } }>(`${api}/tasks/${taskId}/send-to-agent`, { comment }),
    markTaskDone: (taskId, comment?) =>
      post<{ ok: true }>(`${api}/tasks/${taskId}/mark-done`, { comment }),
    decideTask: (taskId, kind, comment) =>
      post<{ ok: true; decision: string; parentWokenForAgentId: string | null }>(
        `${api}/tasks/${taskId}/decision`,
        { kind, comment },
      ),
    addWorkProduct: (taskId, data) => post<{ id: string }>(`${api}/tasks/${taskId}/work-products`, data),

    // Runs
    getRuns: async (filters?) => {
      const params = new URLSearchParams();
      if (filters?.agentId) params.set("agentId", filters.agentId);
      if (filters?.status) params.set("status", filters.status);
      const qs = params.toString();
      const res = await get<{ runs: AgentRun[] }>(`${api}/runs${qs ? `?${qs}` : ""}`);
      return res.runs;
    },
    getRun: (runId) => get<AgentRun>(`${api}/runs/${runId}`),
    cancelRun: async (runId) => { await post(`${api}/runs/${runId}/cancel`, {}); },

    // Runtimes
    getRuntimes: async () => {
      const res = await get<{ runtimes: Record<string, unknown>[] }>(`${api}/runtimes`);
      return res.runtimes;
    },
    createRuntime: (data) => post<Record<string, unknown>>(`${api}/runtimes`, data),
    updateRuntime: (runtimeId, data) => patch<Record<string, unknown>>(`${api}/runtimes/${runtimeId}`, data),
    deleteRuntime: (runtimeId) => del(`${api}/runtimes/${runtimeId}`),
    setDefaultRuntime: async (runtimeId) => { await post(`${api}/runtimes/${runtimeId}/default`, {}); },
    getRuntimeModels: async (runtimeId) => {
      const res = await get<{ models: RuntimeModel[] }>(`${api}/runtimes/${runtimeId}/models`);
      return res.models;
    },

    // Routines
    getRoutines: async () => {
      const res = await get<{ routines: Record<string, unknown>[] }>(`${api}/routines`);
      return res.routines;
    },
    createRoutine: (data) => post<Record<string, unknown>>(`${api}/routines`, data),
    updateRoutine: (routineId, data) => patch<Record<string, unknown>>(`${api}/routines/${routineId}`, data),
    deleteRoutine: (routineId) => del(`${api}/routines/${routineId}`),
    triggerRoutine: (routineId) => post<Record<string, unknown>>(`${api}/routines/${routineId}/trigger`, {}),

    // Workflows
    getWorkflows: async () => {
      const res = await get<{ workflows: Record<string, unknown>[] }>(`${api}/workflows`);
      return res.workflows;
    },
    getWorkflow: (workflowId) => get<Record<string, unknown>>(`${api}/workflows/${workflowId}`),
    createWorkflow: (data) => post<Record<string, unknown>>(`${api}/workflows`, data),
    updateWorkflow: (workflowId, data) => patch<Record<string, unknown>>(`${api}/workflows/${workflowId}`, data),
    deleteWorkflow: (workflowId) => del(`${api}/workflows/${workflowId}`),
    getWorkflowRuns: async (workflowId) => {
      const res = await get<{ runs: Record<string, unknown>[] }>(`${api}/workflows/${workflowId}/runs`);
      return res.runs;
    },

    // Budgets
    getBudgets: async () => {
      const res = await get<{ policies: Record<string, unknown>[] }>(`${api}/budgets`);
      return res.policies;
    },
    createBudget: (data) => post<Record<string, unknown>>(`${api}/budgets`, data),
    deleteBudget: (budgetId) => del(`${api}/budgets/${budgetId}`),
    getBudgetIncidents: async () => {
      const res = await get<{ incidents: Record<string, unknown>[] }>(`${api}/budgets/incidents`);
      return res.incidents;
    },

    // Costs
    getCosts: async () => {
      const res = await get<{ costs: Record<string, unknown>[] }>(`${api}/costs`);
      return res.costs;
    },
    reportCost: async (runId, data) => {
      // v2: cost reporting goes through the framework module's
      // tool, called from inside agent runs only.
      await post(`/api/tools/framework.runs.report_cost`, { runId, ...data });
    },

    // Connectors — OAuth + listing only. Action invocation has
    // moved to /api/tools/<connector>.<action>.
    getConnectors: async () => {
      const res = await get<{ connectors: ConnectorInfo[] }>("/api/connectors/connectors");
      return res.connectors;
    },
    invokeAction: async (kind, action, inputs) => {
      const r = await post<{
        ok: boolean;
        result?: Record<string, unknown>;
        error?: { code: string; message: string };
      }>(`/api/tools/${kind}.${action}`, inputs);
      // Translate v2 response shape to the legacy v1 shape so
      // existing consumers don't need to change.
      return r.ok
        ? { success: true, data: r.result }
        : { success: false, error: r.error?.message };
    },

    // Inbox
    getInbox: async (filters) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
      const qs = params.toString();
      const res = await get<{ items: InboxItem[] }>(
        `${api}/inbox${qs ? `?${qs}` : ""}`,
      );
      return res.items;
    },
    getInboxItem: (itemId) => get<InboxItem>(`${api}/inbox/${itemId}`),
    archiveInboxItem: async (itemId) => {
      await post(`${api}/inbox/${itemId}/archive`, {});
    },
    updateInboxItem: (itemId, data) => patch<InboxItem>(`${api}/inbox/${itemId}`, data),
    createTaskFromInboxItem: (itemId, data) =>
      post<{ taskId: string }>(`${api}/inbox/${itemId}/create-task`, data ?? {}),

    // Realtime SSE subscription
    subscribe: (onEvent) => {
      const params = new URLSearchParams();
      if (config.apiKey) params.set("apiKey", config.apiKey);
      if (config.tenantId) params.set("tenantId", config.tenantId);

      const eventSource = new EventSource(`${baseUrl}/api/events?${params}`);

      eventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          onEvent(event);
        } catch {}
      };

      return () => eventSource.close();
    },
  };
}
