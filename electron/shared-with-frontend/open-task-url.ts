/**
 * `superproductivity://open-task?id=<taskId>` (wiki 3.01 §4): the link the
 * task context menu's "Copy task link" copies, and the protocol action that
 * opens it. Shared so the menu, the main-process handler and the renderer's IPC
 * payload check agree on one format.
 */
export const OPEN_TASK_PROTOCOL_ACTION = 'open-task';

/**
 * Task ids are nanoids (21 chars), but older data and imports carry other
 * shapes, so this is a sanity cap against a garbage payload rather than a
 * format check.
 */
const MAX_TASK_ID_LENGTH = 200;

export const buildOpenTaskUrl = (taskId: string): string =>
  `superproductivity://${OPEN_TASK_PROTOCOL_ACTION}?id=${encodeURIComponent(taskId)}`;

/** The trimmed id, or `null` when it is missing, empty or implausibly long. */
export const normalizeOpenTaskId = (id: unknown): string | null => {
  if (typeof id !== 'string') {
    return null;
  }
  const trimmed = id.trim();
  return trimmed && trimmed.length <= MAX_TASK_ID_LENGTH ? trimmed : null;
};
