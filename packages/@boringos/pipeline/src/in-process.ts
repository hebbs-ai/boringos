import type { QueueAdapter } from "./types.js";
import { generateId } from "@boringos/shared";

export interface InProcessQueueOptions {
  /**
   * Maximum number of jobs to process in parallel. Each slot runs one drain
   * loop; setting N > 1 means up to N agent subprocesses run simultaneously.
   *
   * Pick based on machine size and API rate limits — unbounded is a foot-gun
   * (spawns N subprocesses, hits Anthropic rate caps, exhausts DB pool).
   * Default is 1 (serial) to preserve legacy behavior.
   */
  concurrency?: number;
}

export function createInProcessQueue<T>(options: InProcessQueueOptions = {}): QueueAdapter<T> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const jobs: T[] = [];
  let handler: ((job: T) => Promise<void>) | null = null;
  let running = 0;
  let closed = false;

  // Spawn up to `concurrency` drain loops. Each loop pulls jobs until the
  // queue drains. We increment `running` synchronously before scheduling the
  // setImmediate so the cap is never breached under bursty enqueue.
  function tryStartWorkers(): void {
    if (!handler) return;
    while (running < concurrency && jobs.length > 0 && !closed) {
      running++;
      setImmediate(async () => {
        try {
          while (jobs.length > 0 && !closed && handler) {
            const job = jobs.shift()!;
            try {
              await handler(job);
            } catch {
              // In-process queue has no retry — errors are swallowed.
              // Use BullMQ for production retry semantics.
            }
          }
        } finally {
          running--;
        }
      });
    }
  }

  return {
    name: "in-process",

    async enqueue(job: T): Promise<string> {
      if (closed) throw new Error("Queue is closed");
      const id = generateId();
      jobs.push(job);
      tryStartWorkers();
      return id;
    },

    process(fn: (job: T) => Promise<void>): void {
      handler = fn;
      // Drain any jobs that were enqueued before handler was set
      tryStartWorkers();
    },

    async close(): Promise<void> {
      // Stop pulling NEW jobs, then drain in-flight ones so graceful
      // shutdown can await active runs before shared resources (e.g. the
      // DB pool) are torn down. Without this, an in-flight run queries a
      // closing connection → CONNECTION_ENDED. Bounded so a stuck job
      // can't hang shutdown forever.
      closed = true;
      const deadline = Date.now() + 5000;
      while (running > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };
}
