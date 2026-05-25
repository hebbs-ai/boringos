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

export interface ModuleInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  provides: string[];
  dependsOn: string[];
  tools: Array<{ name: string; description: string }>;
  skills: Array<{ id: string; source: string; priority: number }>;
}

export interface InstallInfo {
  moduleId: string;
  tenantId: string;
  installedAt?: string;
  [k: string]: unknown;
}

/**
 * One row from `module_packages` — a `.hebbsmod` bundle that was
 * uploaded to the host. This is the host-global layer; per-tenant
 * install state lives in `InstallInfo`.
 *
 * See `docs/install-flow.md §1.4`.
 */
export interface ModulePackageInfo {
  id: string;
  version: string;
  kind: "connector" | "module" | "hybrid";
  contentHash: string;
  signaturePublisherId: string | null;
  uploadedAt: string;
  storePath: string;
}

/** 201 success envelope from `POST /api/admin/modules/upload`. */
export interface ModuleUploadSuccess {
  ok: true;
  id: string;
  version: string;
  kind: "connector" | "module" | "hybrid";
  contentHash: string;
  toolsAdded: number;
  skillsAdded: number;
  storePath: string;
}

/** 4xx/5xx error envelope from `POST /api/admin/modules/upload`. */
export interface ModuleUploadError {
  ok: false;
  error: {
    code: string;
    message: string;
    /** For `duplicate` / `version_exists` — info about the existing row. */
    existing?: unknown;
    /** For `installed` — tenants that still have it installed. */
    tenants?: string[];
    detail?: string;
  };
}

export type ModuleUploadResult = ModuleUploadSuccess | ModuleUploadError;

/** 200 success envelope from `DELETE /api/admin/modules/:id?version=…`. */
export interface ModuleDeleteSuccess {
  ok: true;
  id: string;
  version: string;
  toolsRemoved: number;
  skillsRemoved: number;
  restartRecommended: boolean;
  uninstallFailures: Array<{ tenantId: string; reason: string }>;
}

/** 4xx/5xx error envelope from `DELETE /api/admin/modules/:id?version=…`. */
export interface ModuleDeleteError {
  ok: false;
  error: {
    code: string;
    message: string;
    /** For `installed` (409) — tenants that still have it installed. */
    tenants?: string[];
    detail?: string;
  };
}

export type ModuleDeleteResult = ModuleDeleteSuccess | ModuleDeleteError;

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
  ownerKind?: "module" | "framework";
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
   * installed modules + the framework.s own keys). The shell renders
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
      /**
       * Per-agent model override (e.g. `claude-sonnet-4-6`). When set,
       * takes priority over the resolved runtime row's model at run
       * time. Setting / changing this server-side also clears
       * `tasks.session_id` for active tasks so the next wake starts
       * a fresh session under the new model. The PATCH response
       * carries `sessionInvalidation: { tasksCleared, tasksDeferred }`.
       */
      model?: string | null;
      reportsTo?: string | null;
      routingTags?: string[];
      permissions?: Record<string, unknown>;
      budgetMonthlyCents?: number;
    },
  ): Promise<Agent & { sessionInvalidation?: { tasksCleared: number; tasksDeferred: number } }>;
  patchAgentRoutingTags(
    agentId: string,
    data: { add?: string[]; remove?: string[]; set?: string[] },
  ): Promise<{ agentId: string; routingTags: string[] }>;
  wakeAgent(agentId: string, taskId?: string): Promise<Record<string, unknown>>;
  getAgentRuns(agentId: string): Promise<AgentRun[]>;

  /** Tenant id this client is scoped to (mirrors `config.tenantId`).
   *  Hooks key React-Query queries on this so a post-login client
   *  identity change causes a fresh fetch. */
  readonly tenantId?: string;
  /** True when the client carries either an API key or a session token. */
  readonly hasAuth: boolean;

  // Modules — registry + per-tenant install state.
  getModules(): Promise<ModuleInfo[]>;
  getInstalls(): Promise<InstallInfo[]>;
  /** Invoke a tool by full name (e.g. "crm.contacts.list"). Returns the
   *  tool's `result` payload directly, throwing on `ok: false`. */
  invokeTool<T = unknown>(name: string, input: unknown): Promise<T>;
  /** Install a module for the current tenant. */
  installModule(moduleId: string): Promise<{ ok: boolean; hookError?: string }>;
  /** Uninstall a module for the current tenant. */
  uninstallModule(moduleId: string): Promise<{ ok: boolean; hookError?: string }>;

  /**
   * Host-global packages — every `.hebbsmod` bundle that has been
   * uploaded. Each entry is one (id, version) pair. Built-in modules
   * registered via `app.module(...)` at boot do NOT appear here.
   */
  getModulePackages(): Promise<ModulePackageInfo[]>;
  /**
   * Upload a `.hebbsmod` bundle. Streams as multipart/form-data with a
   * `file` field. Does NOT throw on non-2xx — returns the structured
   * error envelope so the UI can render specific messages (e.g. the
   * 409 `version_exists` / `duplicate` path).
   *
   * `force: true` adds `?force=true` to the URL — overwrites an
   * existing package at the same id@version. Use when iterating in
   * dev on a fixed version, or when the host rejected a no-op
   * re-upload (same sha) and you actually want the bytes refreshed.
   */
  uploadModulePackage(
    file: File | Blob,
    opts?: { force?: boolean },
  ): Promise<ModuleUploadResult>;
  /**
   * Delete a package row + remove its extracted store directory. Does
   * NOT throw on non-2xx — the 409 `installed` path returns the list
   * of tenants still using it so the UI can prompt for force-delete.
   */
  deleteModulePackage(
    id: string,
    version: string,
    force?: boolean,
  ): Promise<ModuleDeleteResult>;

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
  // Agent-side callers use /api/tools/* directly (the tool
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

  // ── Realtime SSE: one shared EventSource, fanned out to all listeners ──
  //
  // An EventSource is a real HTTP connection, and browsers cap HTTP/1.1 at
  // ~6 connections per origin. Opening one stream per subscriber (the shell
  // mounts several — one per event type, plus the copilot thinking stream)
  // blows that budget: held-open SSE streams starve every other fetch, which
  // then hangs "pending" forever. The server's /events stream already
  // broadcasts *all* of a tenant's events on a single connection, so we keep
  // exactly one EventSource alive and dispatch each event to every local
  // listener. Ref-counted: opened on the first subscriber, closed when the
  // last one leaves.
  type EventListener = (event: { type: string; data: Record<string, unknown> }) => void;
  const sseListeners = new Set<EventListener>();
  let sseSource: EventSource | null = null;

  function openSharedStream(): void {
    // Already live (OPEN or auto-reconnecting CONNECTING) — reuse it. Only a
    // CLOSED stream (fatal error / explicit close) needs a fresh connection.
    if (sseSource && sseSource.readyState !== EventSource.CLOSED) return;

    const params = new URLSearchParams();
    if (config.apiKey) params.set("apiKey", config.apiKey);
    if (config.tenantId) params.set("tenantId", config.tenantId);
    // EventSource can't set headers — session-authed shells pass the
    // token as a query param (the SSE route validates it like the admin API).
    if (config.token) params.set("token", config.token);

    const source = new EventSource(`${baseUrl}/api/events?${params}`);
    source.onmessage = (e) => {
      let event: { type: string; data: Record<string, unknown> };
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      // Snapshot first: a listener may unsubscribe mid-dispatch, which would
      // otherwise mutate the Set we're iterating.
      for (const listener of [...sseListeners]) {
        try {
          listener(event);
        } catch {}
      }
    };
    sseSource = source;
  }

  function closeSharedStream(): void {
    sseSource?.close();
    sseSource = null;
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

    // Modules
    tenantId: config.tenantId,
    hasAuth: Boolean(config.apiKey || config.token),
    getModules: async () => {
      const res = await get<{ modules: ModuleInfo[] }>(`${api}/modules`);
      return res.modules;
    },
    getInstalls: async () => {
      const res = await get<{ installs: InstallInfo[] }>(`${api}/installs`);
      return res.installs;
    },
    invokeTool: async <T = unknown>(name: string, input: unknown): Promise<T> => {
      const res = await fetch(`${baseUrl}/api/tools/${name}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(input ?? {}),
      });
      if (!res.ok) throw new Error(`POST /api/tools/${name} failed: ${res.status}`);
      const env = (await res.json()) as { ok: boolean; result?: T; error?: { message: string } };
      if (!env.ok) throw new Error(env.error?.message ?? `Tool ${name} failed`);
      return env.result as T;
    },
    installModule: async (moduleId: string) => {
      const res = await fetch(`${baseUrl}${api}/modules/${moduleId}/install`, {
        method: "POST",
        headers: headers(),
      });
      return res.json() as Promise<{ ok: boolean; hookError?: string }>;
    },
    uninstallModule: async (moduleId: string) => {
      const res = await fetch(`${baseUrl}${api}/modules/${moduleId}/uninstall`, {
        method: "POST",
        headers: headers(),
      });
      return res.json() as Promise<{ ok: boolean; hookError?: string }>;
    },

    // Module packages — host-global `.hebbsmod` bundle records.
    getModulePackages: async () => {
      const res = await get<{ packages: ModulePackageInfo[] }>(
        `${api}/modules/packages`,
      );
      return res.packages;
    },
    uploadModulePackage: async (
      file: File | Blob,
      opts?: { force?: boolean },
    ) => {
      const form = new FormData();
      form.append("file", file);
      // Build headers manually — do NOT set Content-Type. The browser
      // fills in the multipart boundary; setting it explicitly would
      // break the body parse.
      const h: Record<string, string> = {};
      if (config.apiKey) h["X-API-Key"] = config.apiKey;
      if (config.tenantId) h["X-Tenant-Id"] = config.tenantId;
      if (config.token) h["Authorization"] = `Bearer ${config.token}`;
      const qs = opts?.force ? "?force=true" : "";
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${api}/modules/upload${qs}`, {
          method: "POST",
          headers: h,
          body: form,
        });
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "network_error",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      // Either success (201) or structured error envelope (4xx/5xx).
      // Do not throw — the UI surfaces the specific error code.
      try {
        return (await res.json()) as ModuleUploadResult;
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "invalid_response",
            message: `Upload returned non-JSON ${res.status} response`,
            detail: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
    deleteModulePackage: async (
      id: string,
      version: string,
      force?: boolean,
    ) => {
      const params = new URLSearchParams({ version });
      if (force) params.set("force", "true");
      let res: Response;
      try {
        res = await fetch(
          `${baseUrl}${api}/modules/${encodeURIComponent(id)}?${params}`,
          { method: "DELETE", headers: headers() },
        );
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "network_error",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      try {
        return (await res.json()) as ModuleDeleteResult;
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "invalid_response",
            message: `Delete returned non-JSON ${res.status} response`,
            detail: err instanceof Error ? err.message : String(err),
          },
        };
      }
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
      // Cost reporting goes through the framework module.s
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
      // Translate the response shape so
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

    // Realtime SSE subscription. All subscribers share one EventSource
    // (see openSharedStream above); the stream is opened on the first
    // subscriber and torn down when the last one unsubscribes.
    subscribe: (onEvent) => {
      sseListeners.add(onEvent);
      openSharedStream();
      return () => {
        sseListeners.delete(onEvent);
        if (sseListeners.size === 0) closeSharedStream();
      };
    },
  };
}
