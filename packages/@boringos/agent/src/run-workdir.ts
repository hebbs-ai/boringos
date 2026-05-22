// task_23 F1 — per-run workdir provisioning.
//
// Every wake gets its own ephemeral directory under
//   <baseDir>/<runId>/
//
// That directory is the agent's `cwd` for the CLI subprocess. Inside
// it we mount the Drive slice the wake can see (see drive-mount.ts),
// inject any curated skills (see skills.ts), and let the agent
// scratch as it pleases. The whole dir is torn down on run
// finalisation — Drive data on the other side of the symlinks is
// untouched (rm of a symlink unlinks the symlink itself, never
// traverses into the target).
//
// Distinct from `provisionWorkspace` in workspace.ts, which creates a
// git worktree for code-bound tasks. Most BoringOS wakes don't need
// git; they need a plain isolated dir. Code-bound tasks can call
// both — workspace.ts for the worktree, this for the run scratchpad.

import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface RunWorkdirOpts {
  runId: string;
  /**
   * Stable directory key. Defaults to `runId`, but callers that need
   * the CLI's `cwd` to be IDENTICAL across successive wakes must pass a
   * stable value (the task id). The agent CLI stores its resumable
   * session keyed by `cwd` (e.g. Claude under
   * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`); if the cwd
   * changes every run, `--resume <sessionId>` can't find the prior
   * conversation and the run dies with "No conversation found". Sessions
   * are task-scoped, so the workdir must be task-scoped too.
   */
  key?: string;
  /**
   * Parent directory under which `<key>/` is created. Defaults to
   * `.data/agent-workdirs/` relative to `process.cwd()`.
   */
  baseDir?: string;
}

/**
 * Create `<baseDir>/<key ?? runId>/` (recursive) and return its
 * absolute path. The dir is wiped first so a re-used key (e.g. the same
 * task waking again, or recovery after a crash that skipped cleanup)
 * always starts from a clean scratchpad — the agent's session lives
 * outside the workdir, so this never touches resumable state.
 */
export async function provisionRunWorkdir(opts: RunWorkdirOpts): Promise<string> {
  const base = opts.baseDir
    ? resolve(opts.baseDir)
    : resolve(process.cwd(), ".data", "agent-workdirs");
  const workDir = join(base, opts.key ?? opts.runId);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  return workDir;
}

/**
 * Recursive delete of the workdir. Symlinks inside the workdir are
 * unlinked, not followed — the Drive data they point at is safe.
 * Errors are swallowed: cleanup failure should never mask a real
 * run failure or block the next wake.
 */
export async function cleanupRunWorkdir(workDir: string): Promise<void> {
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    /* cleanup is best-effort */
  }
}
