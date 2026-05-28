// ── Database configuration ───────────────────────────────────────────────────

export type DatabaseConfig =
  | { url: string }
  | { embedded: true; dataDir?: string; port?: number };

// ── Migration manager ────────────────────────────────────────────────────────

export interface MigrationManager {
  pending(): Promise<MigrationInfo[]>;
  apply(): Promise<MigrationResult>;
  status(): Promise<MigrationInfo[]>;
}

export interface MigrationInfo {
  name: string;
  appliedAt: Date | null;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

// ── Framework table registry ─────────────────────────────────────────────────
// Tables that belong to the framework vs product layer.
// Phase 3 will use this to split Drizzle schema definitions.

export const FRAMEWORK_TABLES = [
  "agents",
  "agent_runs",
  "agent_wakeup_requests",
  "agent_config_revisions",
  "agent_skills",
  "tasks",
  "task_comments",
  "task_work_products",
  "task_attachments",
  "task_labels",
  "task_read_states",
  "runtimes",
  "cost_events",
  "budget_policies",
  "budget_incidents",
  "execution_workspaces",
  "company_skills",
  "canonical_items",
  "workflows",
  "routines",
  "routine_triggers",
  "routine_runs",
  "drive_files",
  "documents",
  "document_revisions",
  "secrets",
  "activity_log",
  // Connector SDK v2 tables. Owned by AuthManager in @boringos/core.
  "connector_accounts",
  "connector_oauth_apps",
  "module_connector_bindings",
  "connector_token_issuance",
] as const;

export type FrameworkTable = (typeof FRAMEWORK_TABLES)[number];
