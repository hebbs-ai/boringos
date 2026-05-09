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

export interface AgentStats {
  total: number;
  runningNow: number;
  pausedNow: number;
  idleNow: number;
  queueDepth: number;
  errors24h: number;
  spentTodayCents: number;
  spentMonthCents: number;
}

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
}

export interface CompanySkill {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  description: string | null;
  sourceType: string;
  sourceConfig: Record<string, unknown>;
  trustLevel: string;
  syncStatus: string;
  lastSyncAt: string | null;
  fileInventory: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface V2ModuleInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  provides: string[];
  dependsOn: string[];
  tools: Array<{ name: string; description: string }>;
  skills: Array<{ id: string; source: string; priority: number }>;
}

export interface V2InstallInfo {
  moduleId: string;
  tenantId: string;
  installedAt?: string;
  [k: string]: unknown;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "staff" | "member";
  joinedAt: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: "admin" | "staff" | "member";
  code: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface SettingDefinition {
  key: string;
  label: string;
  description?: string;
  type: "string" | "boolean" | "number" | "select" | "longtext" | "secret";
  options?: Array<{ value: string; label: string }>;
  default?: string | number | boolean;
  scope?: "tenant" | "user";
  editableBy?: "admin" | "staff" | "member";
  readableBy?: "admin" | "staff" | "member";
  ownerId?: string;
  ownerKind?: "app" | "module" | "framework";
}

export interface SettingsManifest {
  settings: SettingDefinition[];
  defaults: Record<string, string>;
}

export interface ActivityRow {
  id: string;
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string | null;
  actorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
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
  /**
   * Manifest of every SettingDefinition the host has registered (from
   * installed v2 modules + the framework's own keys). The shell renders
   * Settings → General from this. See task_17.
   */
  getSettingsManifest(): Promise<SettingsManifest>;

  // Tenants
  createTenant(data: { name: string; slug: string }): Promise<Record<string, unknown>>;
  getCurrentTenant(): Promise<Record<string, unknown>>;

  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent>;
  getOrgTree(): Promise<OrgNode[]>;
  /** Fleet-wide stats for the cabinet header. */
  getAgentStats(): Promise<AgentStats>;
  /**
   * Per-agent daily run counts over a window. Returns
   * `{ activity: { agentId: { 'YYYY-MM-DD': count } }, days }`.
   */
  getAgentActivity(window?: "7d" | "30d"): Promise<{
    activity: Record<string, Record<string, number>>;
    days: number;
  }>;
  createAgent(data: { name: string; role?: string; instructions?: string; runtimeId?: string }): Promise<Agent>;
  updateAgent(
    agentId: string,
    data: {
      name?: string;
      role?: string;
      title?: string | null;
      icon?: string | null;
      instructions?: string | null;
      status?: string;
      runtimeId?: string | null;
      fallbackRuntimeId?: string | null;
      reportsTo?: string | null;
      routingTags?: string[];
      permissions?: Record<string, unknown>;
      budgetMonthlyCents?: number;
    },
  ): Promise<Agent>;
  patchAgentRoutingTags(
    agentId: string,
    data: { add?: string[]; remove?: string[]; set?: string[] },
  ): Promise<{ agentId: string; routingTags: string[] }>;
  wakeAgent(agentId: string, taskId?: string): Promise<Record<string, unknown>>;
  getAgentRuns(agentId: string): Promise<AgentRun[]>;

  // v2 Modules — registry + per-tenant install state. The shell uses
  // this to render "skills inherited by every agent in this tenant".
  getV2Modules(): Promise<V2ModuleInfo[]>;
  getV2Installs(): Promise<V2InstallInfo[]>;

  // Team + invitations (mounted under /api/auth/*)
  getTeam(): Promise<TeamMember[]>;
  updateTeamMemberRole(userId: string, role: string): Promise<void>;
  removeTeamMember(userId: string): Promise<void>;
  getInvitations(): Promise<PendingInvitation[]>;
  createInvitation(data: { email: string; role?: string }): Promise<{ code: string; inviteLink: string }>;
  deleteInvitation(invitationId: string): Promise<void>;

  // Activity log. Server-side filtering is not yet implemented; the
  // admin route returns all rows for the tenant. Filters here are
  // forwarded as query string for forward-compat.
  getActivity(filters?: { limit?: number }): Promise<ActivityRow[]>;

  // Skills (tenant-curated)
  getSkills(): Promise<CompanySkill[]>;
  createSkill(data: {
    key: string;
    name: string;
    description?: string;
    sourceType: string;
    sourceConfig?: Record<string, unknown>;
    trustLevel?: string;
  }): Promise<CompanySkill>;
  attachSkill(skillId: string, agentId: string): Promise<void>;
  detachSkill(skillId: string, agentId: string): Promise<void>;

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
    getSettingsManifest: () => get<SettingsManifest>(`${api}/settings/manifest`),

    // Tenants
    createTenant: (data) => post<Record<string, unknown>>(`${api}/tenants`, data),
    getCurrentTenant: () => get<Record<string, unknown>>(`${api}/tenants/current`),

    // Agents
    getAgents: async () => {
      const res = await get<{ agents: Agent[] }>(`${api}/agents`);
      return res.agents;
    },
    getAgent: (agentId) => get<Agent>(`${api}/agents/${agentId}`),
    getOrgTree: async () => {
      const res = await get<{ tree: OrgNode[] }>(`${api}/agents/org-tree`);
      return res.tree;
    },
    getAgentStats: () => get<AgentStats>(`${api}/agents/stats`),
    getAgentActivity: (window?: "7d" | "30d") => {
      const qs = window ? `?window=${window}` : "";
      return get<{ activity: Record<string, Record<string, number>>; days: number }>(
        `${api}/agents/activity${qs}`,
      );
    },
    createAgent: (data) => post<Agent>(`${api}/agents`, data),
    updateAgent: (agentId, data) => patch<Agent>(`${api}/agents/${agentId}`, data),
    patchAgentRoutingTags: (agentId, data) =>
      patch<{ agentId: string; routingTags: string[] }>(
        `${api}/agents/${agentId}/routing-tags`,
        data,
      ),
    wakeAgent: (agentId, taskId?) => post<Record<string, unknown>>(`${api}/agents/${agentId}/wake`, { taskId }),
    getAgentRuns: async (agentId) => {
      const res = await get<{ runs: AgentRun[] }>(`${api}/agents/${agentId}/runs`);
      return res.runs;
    },

    // Team (auth namespace, not admin)
    getTeam: async () => {
      const res = await get<{ data: TeamMember[] }>(`/api/auth/team`);
      return res.data;
    },
    updateTeamMemberRole: async (userId, role) => {
      await patch(`/api/auth/team/${userId}/role`, { role });
    },
    removeTeamMember: (userId) => del(`/api/auth/team/${userId}`),

    // Invitations
    getInvitations: async () => {
      const res = await get<{ data: PendingInvitation[] }>(`/api/auth/invitations`);
      return res.data;
    },
    createInvitation: (data) =>
      post<{ code: string; inviteLink: string }>(`/api/auth/invite`, data),
    deleteInvitation: (invitationId) => del(`/api/auth/invitations/${invitationId}`),

    // Activity log
    getActivity: async (filters?) => {
      const params = new URLSearchParams();
      if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
      const qs = params.toString();
      const res = await get<{ activity: ActivityRow[] }>(
        `${api}/activity${qs ? `?${qs}` : ""}`,
      );
      return res.activity;
    },

    // v2 Modules
    getV2Modules: async () => {
      const res = await get<{ modules: V2ModuleInfo[] }>(`${api}/v2/modules`);
      return res.modules;
    },
    getV2Installs: async () => {
      const res = await get<{ installs: V2InstallInfo[] }>(`${api}/v2/installs`);
      return res.installs;
    },

    // Skills
    getSkills: async () => {
      const res = await get<{ skills: CompanySkill[] }>(`${api}/skills`);
      return res.skills;
    },
    createSkill: (data) => post<CompanySkill>(`${api}/skills`, data),
    attachSkill: async (skillId, agentId) => {
      await post(`${api}/skills/${skillId}/attach/${agentId}`, {});
    },
    detachSkill: (skillId, agentId) => del(`${api}/skills/${skillId}/attach/${agentId}`),

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
