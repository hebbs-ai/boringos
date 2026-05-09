import { sql } from "drizzle-orm";
import type { Db } from "./connection.js";
import type { MigrationManager, MigrationInfo, MigrationResult } from "./types.js";
import { FRAMEWORK_TABLES } from "./types.js";

export function createMigrationManager(db: Db): MigrationManager {
  return {
    async pending(): Promise<MigrationInfo[]> {
      return FRAMEWORK_TABLES.map((name) => ({ name, appliedAt: null }));
    },

    async apply(): Promise<MigrationResult> {
      await ensureSchema(db);
      return { applied: [...FRAMEWORK_TABLES], skipped: [] };
    },

    async status(): Promise<MigrationInfo[]> {
      return FRAMEWORK_TABLES.map((name) => ({ name, appliedAt: new Date() }));
    },
  };
}

async function ensureSchema(db: Db): Promise<void> {
  // Create all framework tables using raw SQL DDL.
  // This is the bootstrap path — creates tables if they don't exist.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tenant_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS runtimes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      model TEXT,
      status TEXT NOT NULL DEFAULT 'unchecked',
      health_result JSONB,
      last_checked_at TIMESTAMPTZ,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'general',
      type TEXT NOT NULL DEFAULT 'user',
      title TEXT,
      icon TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      reports_to UUID REFERENCES agents(id),
      instructions TEXT,
      runtime_id UUID REFERENCES runtimes(id) ON DELETE SET NULL,
      fallback_runtime_id UUID REFERENCES runtimes(id) ON DELETE SET NULL,
      budget_monthly_cents INTEGER NOT NULL DEFAULT 0,
      spent_monthly_cents INTEGER NOT NULL DEFAULT 0,
      pause_reason TEXT,
      paused_at TIMESTAMPTZ,
      permissions JSONB NOT NULL DEFAULT '{}',
      last_heartbeat_at TIMESTAMPTZ,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- agent_runtime_state removed: sessions are now task-scoped via
    -- tasks.session_id (one session per task, not per agent).

    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      parent_id UUID REFERENCES tasks(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      assignee_user_id UUID,
      created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_by_user_id UUID,
      issue_number INTEGER,
      identifier TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_id TEXT,
      proposed_params JSONB,
      metadata JSONB,
      session_id TEXT,
      request_depth INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      body TEXT NOT NULL,
      author_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      author_user_id UUID,
      mentions JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_work_products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      metadata JSONB,
      created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_wakeup_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      task_id UUID,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB,
      coalesced_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      wakeup_request_id UUID REFERENCES agent_wakeup_requests(id),
      status TEXT NOT NULL DEFAULT 'queued',
      exit_code INTEGER,
      error TEXT,
      error_code TEXT,
      stdout_excerpt TEXT,
      stderr_excerpt TEXT,
      usage_json JSONB,
      context_snapshot JSONB,
      session_id_before TEXT,
      session_id_after TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cost_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      run_id UUID REFERENCES agent_runs(id),
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      cost_usd TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- approvals + task_approvals removed: approvals are now tasks
    -- (origin_kind="agent_action") with metadata.approval. See
    -- docs/blockers/done/task_06_collapse_approvals_into_tasks.md.

    CREATE TABLE IF NOT EXISTS connectors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      config JSONB NOT NULL DEFAULT '{}',
      credentials JSONB,
      last_sync_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS company_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL,
      source_config JSONB NOT NULL DEFAULT '{}',
      trust_level TEXT NOT NULL DEFAULT 'markdown_only',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      last_sync_at TIMESTAMPTZ,
      file_inventory JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id),
      skill_id UUID NOT NULL REFERENCES company_skills(id),
      state TEXT NOT NULL DEFAULT 'active',
      sync_mode TEXT NOT NULL DEFAULT 'auto',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS drive_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      format TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      hash TEXT,
      synced_to_memory BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'draft',
      governing_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      blocks JSONB NOT NULL DEFAULT '[]',
      edges JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID NOT NULL,
      actor_type TEXT,
      actor_id UUID,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS budget_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'tenant',
      period TEXT NOT NULL DEFAULT 'monthly',
      limit_cents INTEGER NOT NULL,
      warn_threshold_pct INTEGER NOT NULL DEFAULT 80,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS budget_incidents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      policy_id UUID NOT NULL REFERENCES budget_policies(id),
      agent_id UUID REFERENCES agents(id),
      type TEXT NOT NULL,
      spent_cents INTEGER NOT NULL,
      limit_cents INTEGER NOT NULL,
      run_id UUID,
      dismissed TEXT DEFAULT 'false',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS routines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      title TEXT NOT NULL,
      description TEXT,
      assignee_agent_id UUID REFERENCES agents(id),
      workflow_id UUID REFERENCES workflows(id),
      cron_expression TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'active',
      concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_active',
      last_triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plugin_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      plugin_name TEXT NOT NULL,
      key TEXT NOT NULL,
      value JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plugin_job_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      plugin_name TEXT NOT NULL,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      prefix TEXT,
      next_issue_number TEXT NOT NULL DEFAULT '1',
      repo_url TEXT,
      default_branch TEXT DEFAULT 'main',
      branch_template TEXT DEFAULT 'bos/{{identifier}}-{{slug}}',
      settings JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS goals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS labels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      color TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_labels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_read_states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS drive_skill_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      content TEXT NOT NULL,
      changed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS onboarding_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) UNIQUE,
      current_step INTEGER NOT NULL DEFAULT 1,
      total_steps INTEGER NOT NULL DEFAULT 5,
      completed_steps JSONB NOT NULL DEFAULT '[]',
      metadata JSONB NOT NULL DEFAULT '{}',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cli_auth_challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_code TEXT NOT NULL UNIQUE,
      user_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      session_token TEXT,
      user_id TEXT,
      tenant_id UUID,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS evals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      description TEXT,
      test_cases JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      eval_id UUID NOT NULL REFERENCES evals(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'running',
      total_cases INTEGER NOT NULL DEFAULT 0,
      passed_cases INTEGER NOT NULL DEFAULT 0,
      failed_cases INTEGER NOT NULL DEFAULT 0,
      results JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS inbox_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      assignee_user_id TEXT,
      source TEXT NOT NULL,
      source_id TEXT,
      subject TEXT NOT NULL,
      body TEXT,
      "from" TEXT,
      status TEXT NOT NULL DEFAULT 'unread',
      metadata JSONB,
      linked_task_id UUID,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS entity_references (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS entity_refs_entity_idx ON entity_references(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS entity_refs_ref_idx ON entity_references(ref_type, ref_id);

    -- Add columns to tasks if they don't exist
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal_id UUID;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checkout_run_id UUID;
    -- Pre-filled payload for agent_action tasks (Actions queue)
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proposed_params JSONB;
    -- Open-ended metadata jsonb. Stamps the approval decision on
    -- agent_action tasks. See task_06 in docs/blockers/done.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB;
    -- Index for the Actions queue: filter by assignee + status + origin_kind
    CREATE INDEX IF NOT EXISTS tasks_actions_idx ON tasks(tenant_id, assignee_user_id, status, origin_kind);

    -- Workflow execution history (Phase 1 of the workflow UI roadmap)
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      workflow_id UUID NOT NULL REFERENCES workflows(id),
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      trigger_payload JSONB,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS workflow_runs_workflow_started_idx ON workflow_runs(workflow_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS workflow_runs_tenant_started_idx ON workflow_runs(tenant_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_block_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      block_id TEXT NOT NULL,
      block_name TEXT NOT NULL,
      block_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_config JSONB,
      input_context JSONB,
      output JSONB,
      selected_handle TEXT,
      error TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS workflow_block_runs_run_idx ON workflow_block_runs(workflow_run_id);

    -- Phase 3: wait-for-human resume support
    ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS paused_at_block_id TEXT;
    ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS awaiting_action_task_id UUID;

    -- Add assignee_user_id to inbox_items if it doesn't exist (for existing DBs)
    ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS assignee_user_id TEXT;

    -- Snooze: wall-clock when the framework should flip the row back to unread
    ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS inbox_items_snooze_until_idx
      ON inbox_items (snooze_until)
      WHERE status = 'snoozed';

    -- Add model column to agent_runs for tracking which model was used
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model TEXT;

    -- Routing tags column on agents (used by the delegation router for
    -- keyword matching). Originally named "skills" — task_15 §1 renamed
    -- it to disambiguate from prompt skills (modules + company_skills).
    -- This migration is idempotent and handles the transition: add the
    -- new column, backfill from the old one if present, then drop it.
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS routing_tags JSONB NOT NULL DEFAULT '[]'::jsonb;
    DO $$ BEGIN
      UPDATE agents SET routing_tags = skills WHERE routing_tags = '[]'::jsonb;
      ALTER TABLE agents DROP COLUMN skills;
    EXCEPTION WHEN undefined_column THEN NULL; END $$;

    -- Task 07: Agent provenance tracking — distinguish shell/user/app agents
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS source_app_id TEXT;
    -- Idempotent CHECK adds: Postgres has no ADD CONSTRAINT IF NOT EXISTS,
    -- so swallow the duplicate-object error if the constraint exists
    -- already from a prior run.
    DO $$ BEGIN
      ALTER TABLE agents ADD CONSTRAINT agents_source_check CHECK (source IN ('shell', 'user', 'app'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE agents ADD CONSTRAINT agents_source_app_id_check CHECK ((source = 'app') = (source_app_id IS NOT NULL));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Task 07: Tenant root agent pointer — every tenant has exactly one CoS at reports_to IS NULL
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS root_agent_id UUID REFERENCES agents(id);

    -- Backfill: tenants that already have multiple root agents
    -- (existed before this constraint landed) get their extra roots
    -- reparented under the oldest root, so the unique index below
    -- can succeed. Without this, any tenant whose Copilot + default
    -- apps were all installed as roots blocks the migration.
    WITH oldest_root AS (
      SELECT DISTINCT ON (tenant_id) tenant_id, id AS root_id
        FROM agents
       WHERE reports_to IS NULL
       ORDER BY tenant_id, created_at ASC
    )
    UPDATE agents SET reports_to = oldest_root.root_id
      FROM oldest_root
     WHERE agents.tenant_id = oldest_root.tenant_id
       AND agents.reports_to IS NULL
       AND agents.id <> oldest_root.root_id;

    CREATE UNIQUE INDEX IF NOT EXISTS agents_tenant_one_root_idx ON agents(tenant_id) WHERE reports_to IS NULL;

    -- Invitations for multi-tenant team management
    CREATE TABLE IF NOT EXISTS invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS agents_tenant_status_idx ON agents(tenant_id, status);
    CREATE INDEX IF NOT EXISTS agents_tenant_source_idx ON agents(tenant_id, source);
    CREATE INDEX IF NOT EXISTS agents_tenant_source_app_idx ON agents(tenant_id, source_app_id);
    CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx ON tasks(tenant_id, status);
    CREATE INDEX IF NOT EXISTS tasks_assignee_agent_idx ON tasks(assignee_agent_id);
    CREATE INDEX IF NOT EXISTS agent_runs_tenant_agent_idx ON agent_runs(tenant_id, agent_id);

    -- Handoff state machine. Independent of the status column (lifecycle).
    -- 'agent' = agent should pick up; 'human' = waiting on human; NULL = terminal.
    -- Keep the legacy status column untouched so every consumer that
    -- reads it keeps working; the new behavior keys off next_actor only.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_actor TEXT;
    UPDATE tasks SET next_actor = CASE
      WHEN status = 'done' THEN NULL
      WHEN status = 'cancelled' THEN NULL
      WHEN assignee_agent_id IS NOT NULL THEN 'agent'
      ELSE 'human'
    END WHERE next_actor IS NULL;
    CREATE INDEX IF NOT EXISTS tasks_next_actor_idx ON tasks(tenant_id, next_actor) WHERE next_actor IS NOT NULL;

    -- Auto-set next_actor on insert if caller didn't specify one.
    -- This means every existing INSERT path keeps working — no need
    -- to touch admin-routes, copilot module, framework.tasks.create,
    -- inbox-fanout, etc. The trigger derives next_actor from the
    -- assignee at insert time. Status='done'/'cancelled' clear it
    -- back to NULL on update.
    CREATE OR REPLACE FUNCTION tasks_set_next_actor() RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.next_actor IS NULL THEN
        NEW.next_actor := CASE
          WHEN NEW.status IN ('done', 'cancelled') THEN NULL
          WHEN NEW.assignee_agent_id IS NOT NULL THEN 'agent'
          ELSE 'human'
        END;
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.status IN ('done', 'cancelled') AND OLD.status NOT IN ('done', 'cancelled') THEN
        NEW.next_actor := NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS tasks_set_next_actor_trigger ON tasks;
    CREATE TRIGGER tasks_set_next_actor_trigger
      BEFORE INSERT OR UPDATE ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION tasks_set_next_actor();

    -- Phase 2 K4: workflow rows know which app they belong to so re-install can
    -- replace cleanly. ALTER is idempotent via IF NOT EXISTS.
    ALTER TABLE workflows ADD COLUMN IF NOT EXISTS metadata JSONB;

    -- Phase 2 K1: tenant_apps records which apps are installed in which tenants.
    CREATE TABLE IF NOT EXISTS tenant_apps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      app_id TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
      manifest_hash TEXT,
      installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tenant_apps_tenant_app_idx ON tenant_apps(tenant_id, app_id);

    -- Phase 2 K7: tenant_app_links records cross-app capability approvals,
    -- consulted by the uninstall cascade-warning logic.
    CREATE TABLE IF NOT EXISTS tenant_app_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      source_app_id TEXT NOT NULL,
      target_app_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tenant_app_links_uniq_idx
      ON tenant_app_links(tenant_id, source_app_id, target_app_id, capability);

    -- v2 (Skills + Tools + Modules) — additive scaffolding for the
    -- audited tool dispatcher. Phase 1 of task_12. Unused until the
    -- v2 dispatcher lands in Phase 2; safe to ship now because the
    -- v1 code paths never read or write this table.
    CREATE TABLE IF NOT EXISTS tool_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      module_id TEXT NOT NULL,
      invoked_by TEXT NOT NULL,
      agent_id UUID,
      run_id UUID,
      task_id UUID,
      inputs JSONB,
      result JSONB,
      error JSONB,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      idempotency_key TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS tool_calls_tenant_tool_idx
      ON tool_calls(tenant_id, tool_name);
    CREATE INDEX IF NOT EXISTS tool_calls_tenant_started_idx
      ON tool_calls(tenant_id, started_at);
    CREATE INDEX IF NOT EXISTS tool_calls_run_idx
      ON tool_calls(run_id);

    -- v2 CRM module schema. Tables prefixed hebbs_crm__ per the
    -- v2 naming convention. Phase 8 of task_12. Additive: v1 CRM
    -- in the separate repo (with crm_* tables) is unaffected.
    CREATE TABLE IF NOT EXISTS hebbs_crm__pipelines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stages JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_default TEXT NOT NULL DEFAULT 'false',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hebbs_crm__pipelines_tenant_idx
      ON hebbs_crm__pipelines(tenant_id);

    CREATE TABLE IF NOT EXISTS hebbs_crm__contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      title TEXT,
      notes TEXT,
      custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hebbs_crm__contacts_tenant_idx
      ON hebbs_crm__contacts(tenant_id);
    CREATE INDEX IF NOT EXISTS hebbs_crm__contacts_email_idx
      ON hebbs_crm__contacts(tenant_id, email);

    CREATE TABLE IF NOT EXISTS hebbs_crm__deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      pipeline_id UUID NOT NULL,
      stage_id TEXT NOT NULL,
      contact_id UUID,
      expected_close_date TIMESTAMPTZ,
      notes TEXT,
      custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hebbs_crm__deals_tenant_idx
      ON hebbs_crm__deals(tenant_id);
    CREATE INDEX IF NOT EXISTS hebbs_crm__deals_pipeline_idx
      ON hebbs_crm__deals(tenant_id, pipeline_id);
    CREATE INDEX IF NOT EXISTS hebbs_crm__deals_stage_idx
      ON hebbs_crm__deals(tenant_id, stage_id);
    CREATE INDEX IF NOT EXISTS hebbs_crm__deals_contact_idx
      ON hebbs_crm__deals(contact_id);

    CREATE TABLE IF NOT EXISTS hebbs_crm__activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entity_kind TEXT NOT NULL,
      entity_id UUID NOT NULL,
      action TEXT NOT NULL,
      payload JSONB,
      actor_agent_id UUID,
      actor_user_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hebbs_crm__activities_tenant_entity_idx
      ON hebbs_crm__activities(tenant_id, entity_kind, entity_id);

    -- v2 module install state. One row per (tenant, module). The
    -- framework registry knows which modules the host has imported;
    -- this table records which of those a given tenant has actually
    -- installed (via the admin UI or auto-install at signup).
    -- Phase 9 of task_12.
    CREATE TABLE IF NOT EXISTS module_installs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      version TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS module_installs_tenant_module_idx
      ON module_installs(tenant_id, module_id);

    -- v2 module-shipped schema migrations applied per-tenant.
    -- Tracks which Module.schema[].id has been applied for which
    -- (tenant, module). Enables idempotent re-install + clean
    -- rollback at uninstall. Chunk C of the final session.
    CREATE TABLE IF NOT EXISTS module_migrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS module_migrations_uniq_idx
      ON module_migrations(tenant_id, module_id, migration_id);
  `);
}
