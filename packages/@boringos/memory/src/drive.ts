// task_24 — Drive-backed MemoryProvider.
//
// Implements MemoryProvider on top of a StorageBackend. Memory is
// just files. No vector index, no embeddings, no external service.
// Recall is regex grep across the in-scope memory tree, ordered by
// recency. Reads from the Drive backend are the same bytes the
// agent sees through its workdir mount (task_23) — there is one
// source of truth, and both code paths (tools API + native FS)
// converge on it.
//
// Layout (one shape, two roots):
//
//   users/<ownerUserId>/memory/
//     MEMORY.md         — index + active state (agent-maintained)
//     decisions/        — durable choices the user has set
//     domains/          — stable facts about the user's world
//     notes/            — tool-API writes land here (memory.remember)
//     archive/          — promoted-out historical detail
//
//   shared/memory/      — same shape, tenant-wide canonical truth
//
// `memory.remember(content)` writes one file under `notes/`. The
// agent is free (and encouraged by the SKILL) to write directly
// into decisions/, domains/, or MEMORY.md when it has structured
// truth — those go through the workdir mount via Bash/Write, not
// through this provider's API. The two paths read each other's
// writes natively because both are the same filesystem.

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type {
  MemoryMeta,
  MemoryProvider,
  PrimeOptions,
  RecallOptions,
  RecallResult,
} from "./types.js";

// We import the StorageBackend type structurally to avoid a hard
// dependency on the drive package from this package. Anything with
// these methods plugs in (mock backends for tests, the local-FS
// backend in production, future S3 etc.).
export interface DriveLike {
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  write(path: string, content: string | Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix?: string): Promise<Array<{ path: string; name: string; isDirectory: boolean }>>;
  stat(
    path: string,
  ): Promise<{ path: string; size: number; modifiedAt: Date } | null>;
}

export interface DriveMemoryConfig {
  drive: DriveLike;
}

const MEMORY_SKILL_PLACEHOLDER = `Memory lives under \`./drive/users/<owner>/memory/\` (user-scope) and
\`./drive/shared/memory/\` (tenant-shared). The same four-folder shape
applies at each scope:

  MEMORY.md     — index + active state, kept concise (pointers,
                  not warehouses).
  decisions/    — standing rules, settled tradeoffs.
  domains/      — stable facts about entities you work with.
  notes/        — quick captures from \`memory.remember\` and ad-hoc
                  observations.
  archive/      — historical detail rolled out of MEMORY.md.

Read order on wake:
  1. ./drive/users/<owner>/preferences.md  (if a user owns this wake)
  2. ./drive/users/<owner>/memory/MEMORY.md
  3. ./drive/shared/memory/MEMORY.md
  4. The current work's log (./drive/tasks/<id>/log.md or
     ./drive/users/<owner>/sessions/<id>.md) — last N entries
  5. Targeted \`grep\` into decisions/ and domains/ when a topic
     comes up.

Write conventions: one canonical home per fact (anti-duplication).
\`MEMORY.md\` stays prompt-useful — write a one-line pointer there
and the full detail in a sibling file under decisions/ or domains/.

Routing call: *"is this fact only true for this user, or for
everyone in the tenant?"* User preferences → user. Vendor's payment
terms → shared. Customer-account contact name → shared. Vague
observation → notes/ (don't promote yet).

You can write files via Bash/Write directly on \`./drive/.../memory/\`
(faster, composes with grep), OR call \`memory.remember\` for a
quick scratch save when structure isn't ready yet.`;

/**
 * Build a MemoryProvider backed by the Drive filesystem. The
 * provider is shared across all tenants; routing happens per-call
 * via `meta.tenantId` + `meta.scope` + `meta.ownerUserId`.
 */
export function createDriveMemory(config: DriveMemoryConfig): MemoryProvider {
  const { drive } = config;

  return {
    name: "drive",

    skillMarkdown(): string {
      return MEMORY_SKILL_PLACEHOLDER;
    },

    async remember(content: string, meta?: MemoryMeta): Promise<string> {
      const tenantId = meta?.tenantId;
      if (!tenantId) {
        throw new Error(
          "drive-memory: remember() requires meta.tenantId — memory routes per tenant",
        );
      }
      const scope = resolveScope(meta);
      const scopeRoot = scopeRootFor(scope, meta?.ownerUserId);
      if (!scopeRoot) {
        throw new Error(
          `drive-memory: scope "user" requires meta.ownerUserId (the wake-owner)`,
        );
      }

      // Unique filename: ISO timestamp + content hash prefix. The
      // ISO timestamp makes recall's recency sort cheap (alpha
      // sort of filenames is recency sort), and the hash prefix
      // ensures uniqueness on a same-millisecond burst.
      const now = new Date();
      const iso = now.toISOString().replace(/[:.]/g, "-");
      const hash = createHash("sha256")
        .update(content)
        .digest("hex")
        .slice(0, 8);
      const filename = `${iso}-${hash}.md`;
      const memoryId = join(scopeRoot, "memory", "notes", filename);
      const tenantPath = join(tenantId, memoryId);

      const front = renderFrontmatter({
        createdAt: now.toISOString(),
        tags: meta?.tags,
        importance: meta?.importance,
        entityId: meta?.entityId,
      });
      const body = `${front}\n${content}\n`;

      await drive.write(tenantPath, body);
      return memoryId;
    },

    async recall(
      query: string,
      options?: RecallOptions,
    ): Promise<RecallResult[]> {
      const tenantId = options?.tenantId;
      if (!tenantId) {
        throw new Error(
          "drive-memory: recall() requires options.tenantId — memory is per-tenant",
        );
      }

      // Decide which scopes to scan. Default: both, ordered so
      // user-scope results outrank shared (user truth is usually
      // more relevant). If an explicit scope is set, only scan
      // that one. User-scope without ownerUserId can't be addressed
      // — skip it without erroring (no results is the right answer).
      const scopes: Array<{ scope: "user" | "tenant"; root: string }> = [];
      if (!options?.scope || options.scope === "user") {
        const root = scopeRootFor("user", options?.ownerUserId);
        if (root) scopes.push({ scope: "user", root });
      }
      if (!options?.scope || options.scope === "tenant") {
        scopes.push({ scope: "tenant", root: scopeRootFor("tenant") as string });
      }

      const rx = safeRegex(query);
      const limit = options?.limit ?? 20;
      const results: RecallResult[] = [];

      for (const { scope, root } of scopes) {
        if (results.length >= limit) break;
        const memoryRoot = join(tenantId, root, "memory");
        // List all files under memory/. The backend's list is
        // single-level; walk recursively. The corpus is small enough
        // (per scope) that this is cheap until it isn't — at which
        // point an index can layer on without changing the contract.
        const files = await walk(drive, memoryRoot);
        // Sort by name descending — our remember() uses ISO
        // timestamps as filenames, so this sorts recency first
        // (newest at the top).
        files.sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));

        for (const file of files) {
          if (results.length >= limit) break;
          if (!file.path.endsWith(".md")) continue;
          let text: string;
          try {
            text = await drive.readText(file.path);
          } catch {
            continue;
          }
          if (!rx.test(text) && !rx.test(file.path)) continue;
          // Score is just a placeholder for now — files near the
          // top of the list (recent) score higher. When embeddings
          // come, this is where they'd plug in.
          const score = 1 - results.length / Math.max(limit, 1);
          // Memory id is the path relative to the tenant root,
          // matching what remember() returns.
          const id = file.path.slice(tenantId.length + 1);
          results.push({
            id,
            content: stripFrontmatter(text),
            score,
            meta: { scope, ownerUserId: options?.ownerUserId, tenantId },
            createdAt: file.modifiedAt,
          });
        }
      }

      const minScore = options?.minScore ?? 0;
      return results.filter((r) => r.score >= minScore);
    },

    async prime(_context: string, _options?: PrimeOptions): Promise<string | null> {
      // Prime is a "give me a summary the agent can use" call. For
      // Drive-backed memory there is no summarisation step — the
      // agent reads MEMORY.md directly via its mount. Returning
      // null tells callers to fall back to that path.
      return null;
    },

    async forget(memoryId: string): Promise<void> {
      // memoryId is the path relative to the tenant root. We have
      // to derive tenantId from somewhere — for now, accept that
      // the caller passes a full `<tenantId>/<rel>` path when
      // tenant context isn't already in scope. The memory module's
      // forget tool plumbs tenantId through and constructs the
      // full path before calling here.
      await drive.delete(memoryId);
    },

    async ping(): Promise<boolean> {
      // Drive-backed memory has no upstream to ping. If the backend
      // is wired, we're live.
      return true;
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function resolveScope(meta?: MemoryMeta): "user" | "tenant" {
  if (meta?.scope) return meta.scope;
  return meta?.ownerUserId ? "user" : "tenant";
}

function scopeRootFor(
  scope: "user" | "tenant",
  ownerUserId?: string,
): string | null {
  if (scope === "tenant") return "shared";
  if (!ownerUserId) return null;
  return `users/${ownerUserId}`;
}

function renderFrontmatter(fields: {
  createdAt: string;
  tags?: string[];
  importance?: number;
  entityId?: string;
}): string {
  const lines = ["---", `createdAt: ${fields.createdAt}`];
  if (fields.tags?.length) lines.push(`tags: [${fields.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  if (typeof fields.importance === "number") lines.push(`importance: ${fields.importance}`);
  if (fields.entityId) lines.push(`entityId: ${fields.entityId}`);
  lines.push("---");
  return lines.join("\n");
}

function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return text;
  const after = text.slice(end + 4);
  return after.startsWith("\n") ? after.slice(1) : after;
}

function safeRegex(query: string): RegExp {
  try {
    return new RegExp(query, "i");
  } catch {
    // Treat invalid regex as a literal substring search.
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

/**
 * Recursive directory walk against a StorageBackend. The backend
 * gives us one level at a time; we recurse into directories. Stats
 * are fetched lazily — only for files we'll actually score.
 */
async function walk(
  drive: DriveLike,
  prefix: string,
): Promise<Array<{ path: string; modifiedAt?: Date }>> {
  const out: Array<{ path: string; modifiedAt?: Date }> = [];
  // Hard cap on tree size to keep recall predictable. Once a tenant
  // crosses 5k memory files we need an index — surface as a
  // TODO at that point.
  const HARD_CAP = 5000;
  await walkInner(drive, prefix, out, HARD_CAP);
  // Cheap stat pass for ordering / RecallResult.createdAt.
  for (const entry of out) {
    const s = await drive.stat(entry.path);
    if (s) entry.modifiedAt = s.modifiedAt;
  }
  return out;
}

async function walkInner(
  drive: DriveLike,
  prefix: string,
  out: Array<{ path: string }>,
  capRemaining: number,
): Promise<number> {
  let remaining = capRemaining;
  if (remaining <= 0) return 0;
  let entries: Array<{ path: string; name: string; isDirectory: boolean }>;
  try {
    entries = await drive.list(prefix);
  } catch {
    return remaining;
  }
  for (const e of entries) {
    if (remaining <= 0) break;
    if (e.isDirectory) {
      remaining = await walkInner(drive, e.path, out, remaining);
    } else {
      out.push({ path: e.path });
      remaining -= 1;
    }
  }
  return remaining;
}

// Re-exported for tests that want to assert path shapes without
// reaching into internals.
export const __testing__ = {
  resolveScope,
  scopeRootFor,
  stripFrontmatter,
};

// `dirname` is unused at runtime today but kept imported for the
// next change (M3 auto-checkpoint hook will write to a sibling
// directory and needs path manipulation here).
void dirname;
