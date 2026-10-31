import { TaskHistoryEnvelope } from './task-history.model';
import { isTaskHistoryEnvelope } from './task-history.validation';

/** App-owned namespace, separate from the task-history viewer's plugin ID. */
export const TASK_HISTORY_DELIVERY_PREFIX = 'sp-internal-task-history:';

/**
 * A standard opaque user-data record carries immutable author facts across
 * task LWW resolution. Older clients can retain/relay it without new op types.
 */
export const readTaskHistoryDelivery = (
  payload: unknown,
): TaskHistoryEnvelope | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const root = payload as Record<string, unknown>;
  const item = root['pluginUserData'] ?? root;
  if (!item || typeof item !== 'object') return undefined;
  const { id, data } = item as Record<string, unknown>;
  if (typeof id !== 'string' || !id.startsWith(TASK_HISTORY_DELIVERY_PREFIX))
    return undefined;
  if (typeof data !== 'string') throw new Error('Invalid task history delivery');
  const envelope: unknown = JSON.parse(data);
  if (
    !isTaskHistoryEnvelope(envelope) ||
    id !== `${TASK_HISTORY_DELIVERY_PREFIX}${envelope.operationId}`
  ) {
    throw new Error('Invalid task history delivery');
  }
  return envelope;
};
