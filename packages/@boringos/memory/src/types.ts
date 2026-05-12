import type { SkillProvider } from "@boringos/shared";

// ── MemoryProvider — the universal memory interface ──────────────────────────

export interface MemoryProvider extends SkillProvider {
  readonly name: string;

  remember(content: string, meta?: MemoryMeta): Promise<string>;
  recall(query: string, options?: RecallOptions): Promise<RecallResult[]>;
  prime(context: string, options?: PrimeOptions): Promise<string | null>;
  forget(memoryId: string): Promise<void>;
  ping(): Promise<boolean>;
}

// ── Supporting types ─────────────────────────────────────────────────────────

export interface MemoryMeta {
  /**
   * task_24 — tenant the memory is scoped to. Drive-backed memory
   * uses this to route writes to `<tenantId>/{users,shared}/...`.
   * External providers (Hebbs etc.) typically derive tenancy from
   * the configured endpoint/workspace and may ignore this field.
   */
  tenantId?: string;
  /**
   * task_24 — user-scope vs tenant-scope routing.
   *   "user"   → stored under users/<ownerUserId>/memory/...
   *   "tenant" → stored under shared/memory/...
   *
   * Memory tools resolve this from the wake's human context: user
   * when wakeOwnerUserId is set, tenant otherwise. The agent can
   * override per call when promoting user-scope observations to
   * tenant-canonical truth.
   */
  scope?: "user" | "tenant";
  /**
   * task_24 — required when scope === "user". The wake-owner id
   * resolved by wake-context. Routine/cron wakes (no owner)
   * cannot write user-scope memory.
   */
  ownerUserId?: string;
  entityId?: string;
  importance?: number;
  tags?: string[];
}

export interface RecallOptions {
  /** task_24 — tenant scope, see MemoryMeta. */
  tenantId?: string;
  /** task_24 — restrict recall to user-scope or tenant-scope.
   *  Unset means search both (user-scope first when ownerUserId
   *  is provided). */
  scope?: "user" | "tenant";
  /** task_24 — needed to address user-scope memory. */
  ownerUserId?: string;
  entityId?: string;
  limit?: number;
  minScore?: number;
}

export interface PrimeOptions {
  entityId?: string;
  limit?: number;
}

export interface RecallResult {
  id: string;
  content: string;
  score: number;
  meta?: MemoryMeta;
  createdAt?: Date;
}
