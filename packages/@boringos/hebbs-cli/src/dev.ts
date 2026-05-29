// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `hebbs dev <module>` — boot a headless host against the module and
// keep it alive until Ctrl+C. Prints the URL the user hits with
// `curl` (or pairs with a separately-running Shell SPA) plus the
// callback JWT so they can dispatch tools by hand.
//
// MDK T6.1: stay-alive + smoke. MDK T6.2: file watcher → host.reload().

import { createDevHost, type DevHost, type ReloadResult } from "@boringos/dev-host";
import { watch as fsWatch, statSync } from "node:fs";
import { extname } from "node:path";

export interface DevOptions {
  modulePath: string;
  /** Optional smoke tool the dev command dispatches once at boot
   *  to confirm wiring before holding the host open. */
  smokeToolName?: string;
  smokeToolInputs?: unknown;
  /**
   * Hot-reload behaviour (MDK T6.2):
   * - `auto` (default): watch when `modulePath` is a directory; never
   *   watch a `.hebbsmod` archive (zip contents are opaque to fs.watch).
   * - `true`: force-on (fails fast for `.hebbsmod` paths).
   * - `false`: no watcher.
   */
  watch?: boolean | "auto";
  /** Debounce window for clustered file events. Default 250ms. */
  watchDebounceMs?: number;
  /** Called after every successful reload — used by CLI to log, tests
   *  to assert. Receives the reload result. */
  onReload?: (r: ReloadResult) => void;
  /** Called when a reload throws. Default: rethrow on next call. */
  onReloadError?: (err: unknown) => void;
  /**
   * Use an external Postgres (URL or `DATABASE_URL`-style string)
   * instead of the embedded default. Pairs with the
   * `recipes/docker/docker-compose.yml` recipe. MDK T6.3.
   */
  postgresUrl?: string;
}

export interface DevHandle {
  host: DevHost;
  /** Tear the host down. Wired to SIGINT in CLI invocations. */
  shutdown: () => Promise<void>;
  /** True while a watcher is armed. */
  watching: boolean;
}

/**
 * Boot a dev-host and return a handle. The host stays alive until
 * `shutdown()` is called. The CLI wires shutdown to SIGINT/SIGTERM;
 * programmatic callers (e.g. tests) call it explicitly.
 */
export async function startDev(opts: DevOptions): Promise<DevHandle> {
  const host = await createDevHost({
    modulePath: opts.modulePath,
    databaseUrl: opts.postgresUrl,
  });

  if (opts.smokeToolName) {
    await host.dispatch(opts.smokeToolName, opts.smokeToolInputs ?? {});
  }

  // ── Hot reload watcher (MDK T6.2) ──────────────────────────────
  const shouldWatch = resolveWatchMode(
    opts.watch ?? "auto",
    opts.modulePath,
  );
  let stopWatcher: (() => void) | null = null;

  if (shouldWatch) {
    const debounceMs = opts.watchDebounceMs ?? 250;
    let pending: NodeJS.Timeout | null = null;
    let reloading = false;
    let dirty = false;

    const runReload = async (): Promise<void> => {
      if (reloading) {
        dirty = true;
        return;
      }
      reloading = true;
      try {
        const result = await host.reload();
        opts.onReload?.(result);
      } catch (err) {
        if (opts.onReloadError) opts.onReloadError(err);
        else {
          process.stderr.write(
            `  ✗ reload failed — ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      } finally {
        reloading = false;
        if (dirty) {
          dirty = false;
          // Coalesce events that arrived while we were reloading.
          schedule();
        }
      }
    };

    const schedule = (): void => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        void runReload();
      }, debounceMs);
    };

    const watcher = fsWatch(
      opts.modulePath,
      { recursive: true, persistent: false },
      (eventType, filename) => {
        // Filter noise: node_modules, dotdirs, and unrelated extensions.
        if (!filename) {
          schedule();
          return;
        }
        const f = String(filename);
        if (f.startsWith("node_modules/") || f.includes("/node_modules/"))
          return;
        if (f.startsWith(".git/") || f.includes("/.git/")) return;
        if (f.endsWith("~") || f.endsWith(".swp")) return;
        const ext = extname(f);
        // Allow .ts/.tsx/.js/.mjs/.json (manifest/source) + bare names
        // (which fs.watch can emit on directory creates).
        const watched = [
          ".ts",
          ".tsx",
          ".js",
          ".mjs",
          ".cjs",
          ".json",
          ".md",
          "",
        ];
        if (!watched.includes(ext)) return;
        schedule();
      },
    );
    watcher.on("error", (err) => {
      // Posix fs.watch can emit EMFILE under load; don't crash dev.
      process.stderr.write(`  ⚠ watcher error: ${err.message}\n`);
    });
    stopWatcher = () => {
      if (pending) {
        clearTimeout(pending);
        pending = null;
      }
      watcher.close();
    };
  }

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (stopWatcher) stopWatcher();
    await host.close().catch(() => {
      /* best-effort */
    });
  };

  return { host, shutdown, watching: stopWatcher !== null };
}

function resolveWatchMode(
  mode: boolean | "auto",
  modulePath: string,
): boolean {
  if (mode === false) return false;
  const isArchive = modulePath.endsWith(".hebbsmod");
  if (mode === true) {
    if (isArchive) {
      // Force-on with an archive is almost certainly a user mistake;
      // refuse so we don't silently watch nothing useful.
      throw new Error(
        "hebbs dev --watch: cannot watch a .hebbsmod archive. Point at the module source directory instead.",
      );
    }
    return true;
  }
  // auto
  if (isArchive) return false;
  try {
    return statSync(modulePath).isDirectory();
  } catch {
    return false;
  }
}
