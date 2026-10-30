import { createHmac, randomBytes } from 'crypto';
import { CAPTURE_RETRY_WINDOW_MS } from './capture.const';
import type { CreateTaskArgs } from './create-task.tool';

/**
 * Best-effort dedupe of assistant retries: assistants re-send a create after a
 * timeout without an idempotency id (Stage A probe: 0 of 7 calls sent one).
 * Per grant, calls run one at a time and an identical call (title, notes,
 * due date/time and recurrence) within the window answers "Saved" again without
 * a new item. A deliberate identical repeat inside the window is merged too.
 *
 * shortcut: in-process lock and map, single SuperSync instance (helm max 1).
 * Restarts drop it; move to a table if the server scales out.
 */

// Hashed rather than stored as text, so capture content never sits in memory
// longer than its request.
const processKey = randomBytes(32);
const recent = new Map<string, Map<string, number>>();
const locks = new Map<string, Promise<unknown>>();

const contentKey = (c: CreateTaskArgs): string =>
  createHmac('sha256', processKey)
    .update(
      JSON.stringify([
        c.title,
        c.notes ?? null,
        c.dueDate ?? null,
        c.dueTime ?? null,
        c.repeat ?? null,
      ]),
    )
    .digest('base64');

const pruneGrant = (grantId: string, now: number): Map<string, number> | undefined => {
  const entries = recent.get(grantId);
  if (!entries) return undefined;
  for (const [key, expiresAt] of entries) {
    if (expiresAt <= now) entries.delete(key);
  }
  if (entries.size === 0) recent.delete(grantId);
  return entries.size === 0 ? undefined : entries;
};

/** Runs `fn` after every earlier call for the same grant has settled. */
export const withGrantLock = async <T>(
  grantId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const previous = locks.get(grantId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const settled = run.catch(() => undefined);
  locks.set(grantId, settled);
  try {
    return await run;
  } finally {
    // Only the last caller in the chain removes it, so the map stays bounded.
    if (locks.get(grantId) === settled) locks.delete(grantId);
  }
};

export const isRecentCapture = (
  grantId: string,
  content: CreateTaskArgs,
  now: number = Date.now(),
): boolean => pruneGrant(grantId, now)?.has(contentKey(content)) ?? false;

/** Call only after the item's insert committed. */
export const recordCapture = (
  grantId: string,
  content: CreateTaskArgs,
  now: number = Date.now(),
): void => {
  const entries = pruneGrant(grantId, now) ?? new Map<string, number>();
  entries.set(contentKey(content), now + CAPTURE_RETRY_WINDOW_MS);
  recent.set(grantId, entries);
};

/** Daily sweep for grants that stopped calling. */
export const pruneRetryWindow = (now: number = Date.now()): void => {
  for (const grantId of [...recent.keys()]) pruneGrant(grantId, now);
};

/** @internal tests only */
export const resetCaptureMemoryForTests = (): void => {
  recent.clear();
  locks.clear();
};
