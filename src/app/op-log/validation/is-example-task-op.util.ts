import {
  ActionType,
  extractActionPayload,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';

/**
 * Startup example/onboarding tasks are generated locally on first run (see
 * ExampleTasksService) and carry an `isExampleTask: true` marker on their op-log op
 * payload only — never on the NgRx Task entity. They must not count as "meaningful
 * local work" that would block an incoming SYNC_IMPORT or a file-based snapshot adopt
 * (see #7985 / #7976 / #7980).
 *
 * This predicate is only ever evaluated against LOCAL pending ops from getUnsynced() —
 * never against incoming remote ops — so a remote-supplied `isExampleTask` flag can
 * never be used to bypass a conflict dialog.
 */
export const isExampleTaskCreateOp = (entry: OperationLogEntry): boolean => {
  const { op } = entry;
  if (
    op.actionType !== ActionType.TASK_SHARED_ADD ||
    op.opType !== OpType.Create ||
    op.entityType !== 'TASK'
  ) {
    return false;
  }

  const actionPayload = extractActionPayload(op.payload);
  return actionPayload['isExampleTask'] === true;
};
