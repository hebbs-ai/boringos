// SPDX-License-Identifier: MIT
//
// Drive ACL + path validation. Shared between the file-serve HTTP
// route (for browser fetches) and the v2 drive tools (for agent
// reads/writes). The model is deliberately simple: paths are
// partitioned by prefix, and the prefix tells you who can access
// the file. No per-file ACL table, no userId column on driveFiles.
//
// See docs/blockers/task_14_drive_shell_and_artifact_delivery.md §3
// for the full design.

/** Path prefixes the framework recognizes. The first segment of any
 * agent-supplied path is matched against this set. */
export const KNOWN_PREFIXES = [
  "shared",
  "projects",
  "tasks",
  "users",
  "agents",
] as const;

export type KnownPrefix = (typeof KNOWN_PREFIXES)[number];

export interface UserActor {
  kind: "user";
  userId: string;
  role: string;
}

export interface AgentActor {
  kind: "agent";
  agentId?: string;
  /** The task the agent is currently running for, if any. */
  taskId?: string;
}

export type Actor = UserActor | AgentActor;

export type Op = "read" | "write";

export type Decision =
  | { ok: true }
  | { ok: false; reason: string };

// ── Path validation ────────────────────────────────────────────────

/** Validates a user-supplied drive path. Returns the canonical
 * (decoded, slash-normalized) form. Rejects anything that could
 * escape the tenant root: `..` segments, absolute paths, percent-
 * encoded equivalents, embedded null bytes. */
export function validatePath(rawPath: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return { ok: false, reason: "empty path" };
  }

  // Reject percent-encoded forms before any decoding so a single
  // pass catches `%2e%2e` and friends.
  if (/%2e/i.test(rawPath) || /%2f/i.test(rawPath) || /%5c/i.test(rawPath) || /%00/i.test(rawPath)) {
    return { ok: false, reason: "encoded traversal not allowed" };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { ok: false, reason: "invalid url encoding" };
  }

  if (decoded.includes("\0")) {
    return { ok: false, reason: "null byte not allowed" };
  }

  // Absolute paths (Unix or Windows) are not user-controllable.
  if (decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded)) {
    return { ok: false, reason: "absolute paths not allowed" };
  }

  // Backslashes get folded to forward slashes so windows-style
  // paths can't sneak `..\\` past the segment check below.
  const normalized = decoded.replace(/\\/g, "/");

  // Per-segment `..` rejection. Empty segments (double slashes) are
  // also invalid — they often appear in path-traversal probes.
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      return { ok: false, reason: "parent traversal not allowed" };
    }
    if (seg === "" && segments[segments.length - 1] !== "") {
      // trailing slash on a directory is fine; mid-path empty isn't
      return { ok: false, reason: "empty path segment not allowed" };
    }
    if (seg.includes("\0")) {
      return { ok: false, reason: "null byte not allowed" };
    }
  }

  // Strip leading `./` — harmless but noise.
  const stripped = normalized.replace(/^(\.\/)+/, "");
  if (stripped.length === 0) {
    return { ok: false, reason: "empty path after normalization" };
  }

  return { ok: true, path: stripped };
}

// ── Prefix matching ────────────────────────────────────────────────

export interface PrefixMatch {
  prefix: KnownPrefix;
  /** The id segment after the prefix (taskId, userId, etc.). May be
   * empty for `shared/...` which has no id segment. */
  scopeId: string | null;
  /** The remainder of the path after `<prefix>/<scopeId>/`. */
  rest: string;
}

/** Identifies which known prefix a path falls under. Returns null
 * for unrecognized prefixes (legacy / pre-convention paths). */
export function matchPrefix(path: string): PrefixMatch | null {
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const head = segments[0];
  if (!KNOWN_PREFIXES.includes(head as KnownPrefix)) return null;

  const prefix = head as KnownPrefix;

  if (prefix === "shared") {
    return { prefix, scopeId: null, rest: segments.slice(1).join("/") };
  }

  // The other four prefixes all expect an id segment.
  const scopeId = segments[1] ?? "";
  const rest = segments.slice(2).join("/");
  return { prefix, scopeId, rest };
}

// ── Default-path resolution ────────────────────────────────────────

/** When an agent passes a relative filename (no recognized prefix),
 * the framework places it under the right scope automatically. */
export function resolveAgentPath(
  rawPath: string,
  ctx: { taskId?: string; agentId?: string },
): { ok: true; path: string } | { ok: false; reason: string } {
  const v = validatePath(rawPath);
  if (!v.ok) return v;
  const path = v.path;

  const match = matchPrefix(path);
  if (match) {
    // Agent supplied an explicit prefix — honor as-is. ACL applies
    // separately in canAccess.
    return { ok: true, path };
  }

  // No recognized prefix — auto-place.
  if (ctx.taskId) {
    return { ok: true, path: `tasks/${ctx.taskId}/${path}` };
  }
  if (ctx.agentId) {
    return { ok: true, path: `agents/${ctx.agentId}/${path}` };
  }
  return {
    ok: false,
    reason:
      "relative path requires a taskId or agentId in the run context — use an explicit prefix (tasks/, shared/, users/, projects/, agents/)",
  };
}

// ── ACL ────────────────────────────────────────────────────────────

/** The single authorization function. Called by the file-serve route
 * (with a UserActor) and by the v2 drive tools (with an AgentActor).
 * Both surfaces share the same prefix rules so behaviour stays
 * consistent. */
export function canAccess(actor: Actor, op: Op, path: string): Decision {
  const match = matchPrefix(path);

  // Legacy / unrecognized prefix — tenant-shared by default. The
  // tenant boundary is enforced upstream (the path is already
  // tenant-prefixed at storage time); this rule just defines what
  // happens within the tenant.
  if (!match) {
    return { ok: true };
  }

  if (actor.kind === "user") {
    return canUserAccess(actor, op, match);
  }
  return canAgentAccess(actor, op, match);
}

function canUserAccess(user: UserActor, _op: Op, match: PrefixMatch): Decision {
  switch (match.prefix) {
    case "shared":
    case "projects":
    case "tasks":
    case "agents":
      // Tenant-wide read+write for any logged-in member.
      return { ok: true };
    case "users": {
      // Private to the named user. Admins can also access for
      // operational reasons (audit, support, deletion).
      if (match.scopeId === user.userId) return { ok: true };
      if (user.role === "admin") return { ok: true };
      return { ok: false, reason: "users/<id>/ is private" };
    }
  }
}

function canAgentAccess(agent: AgentActor, op: Op, match: PrefixMatch): Decision {
  switch (match.prefix) {
    case "shared":
    case "projects":
    case "tasks":
      // Tenant-shared surfaces. Tasks are visible to every agent
      // in the tenant today, so deliverables under any tasks/<id>/
      // folder are reachable to any agent. The browser-side ACL
      // (route layer) enforces user privacy where it matters.
      return { ok: true };
    case "agents": {
      // Reads: any agent's working dir within tenant. Writes: only
      // the agent's own dir — keeps one agent from clobbering
      // another agent's scratch.
      if (op === "read") return { ok: true };
      if (!agent.agentId) {
        return { ok: false, reason: "agent run has no agentId — cannot write to agents/" };
      }
      if (match.scopeId !== agent.agentId) {
        return { ok: false, reason: "agent may only write to its own agents/<id>/ folder" };
      }
      return { ok: true };
    }
    case "users": {
      // Agents do not get to read or write user-private folders.
      // If you want an agent to see a file, put it in tasks/,
      // shared/, or projects/.
      return { ok: false, reason: "users/<id>/ is private — not accessible to agents" };
    }
  }
}
