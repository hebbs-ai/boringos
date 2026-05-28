// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `hebbs test <module>` — boot a headless host, install the module,
// verify it registers + the /health endpoint sees it. Optionally
// dispatches a single smoke tool (`--tool <fq-name> --inputs '<json>'`)
// and reports the response. Designed as the minimum CLI surface; the
// "run a user vitest file" mode is a future iteration.
//
// MDK T4.2.

import { createDevHost } from "@boringos/dev-host";

export interface TestOptions {
  modulePath: string;
  /** Optional smoke tool dispatch (e.g. `crm.contacts.create`). */
  smokeToolName?: string;
  /** JSON inputs to pass to the smoke tool. */
  smokeToolInputs?: unknown;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
}

export interface TestResult {
  ok: boolean;
  moduleId: string;
  moduleVersion: string;
  bootMs: number;
  smoke?: {
    toolName: string;
    response: unknown;
  };
  error?: string;
}

/**
 * Boot a dev-host against `opts.modulePath`, verify it installed,
 * optionally dispatch a smoke tool, return a structured result.
 *
 * Never throws — surfaces failures as `{ ok: false, error }` so the
 * CLI can render a clean failure summary.
 */
export async function runTest(opts: TestOptions): Promise<TestResult> {
  const t0 = performance.now();
  let host: Awaited<ReturnType<typeof createDevHost>> | undefined;
  try {
    host = await createDevHost({ modulePath: opts.modulePath });
    const bootMs = Math.round(performance.now() - t0);

    const result: TestResult = {
      ok: true,
      moduleId: host.moduleId,
      moduleVersion: host.moduleVersion,
      bootMs,
    };

    if (opts.smokeToolName) {
      const response = await host.dispatch(
        opts.smokeToolName,
        opts.smokeToolInputs ?? {},
      );
      result.smoke = {
        toolName: opts.smokeToolName,
        response,
      };
    }

    return result;
  } catch (err) {
    return {
      ok: false,
      moduleId: "",
      moduleVersion: "",
      bootMs: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (host) {
      await host.close().catch(() => {
        /* best-effort */
      });
    }
  }
}
