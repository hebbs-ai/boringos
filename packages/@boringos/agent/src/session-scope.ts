/**
 * Runtime-scoped session resume.
 *
 * A session belongs to the runtime that created it — a Claude session id
 * cannot be resumed by pi (and vice versa). This is what makes switching an
 * agent's runtime a zero-migration operation: all durable data (tasks,
 * comments, memory) is kept, only session continuity is dropped.
 *
 * Returns the stored session id ONLY when it was created by the agent's
 * current runtime; otherwise `undefined` → the engine starts a fresh session
 * (and `session.ts` takes its Mode B/C path, never a false "resuming
 * session X"). Legacy rows have a null runtime type → treated as "claude",
 * so pre-existing Claude agents keep resuming unchanged.
 *
 * See docs/pi-runtime-integration.md → "runtime-scoped sessions".
 */
export function resolveResumableSessionId(
  storedSessionId: string | null | undefined,
  storedRuntimeType: string | null | undefined,
  currentRuntimeType: string,
): string | undefined {
  if (!storedSessionId) return undefined;
  const owner = storedRuntimeType ?? "claude"; // legacy null ⇒ claude
  return owner === currentRuntimeType ? storedSessionId : undefined;
}
