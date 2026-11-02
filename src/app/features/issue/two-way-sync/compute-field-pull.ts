import { Task } from '../../tasks/task.model';
import { issueValuesEqual } from './compute-push-decisions';
import { FieldMapping, FieldMappingContext, FieldSyncConfig } from './issue-sync.model';

const canPull = (direction: string): boolean =>
  direction === 'pullOnly' || direction === 'both';

const canPush = (direction: string): boolean =>
  direction === 'pushOnly' || direction === 'both';

export interface FieldPullInput {
  task: Task;
  /** The fresh remote item, keyed by issue field. */
  issueValues: Record<string, unknown>;
  /** The provider's row-level marker (ETag, `updatedAt`) moved since the last pull. */
  wasUpdated: boolean;
  /**
   * The provider's full import data for the item (`getAddTaskData`), used as the
   * base when `wasUpdated`; it carries the new baseline and marker. Mapped fields
   * in it are replaced by the per-field decisions below.
   */
  addTaskData: Partial<Task>;
  fieldMappings: FieldMapping[];
  syncConfig: FieldSyncConfig;
  ctx: FieldMappingContext;
  /**
   * `true` (CalDAV): a `pullOnly` field always takes the remote value when the
   * marker moved, and a mismatch is healed even when it did not. `false`
   * (Plainspace): every pullable field is pulled only when its remote value
   * differs from its baseline, so a local edit survives an unrelated remote
   * change.
   */
  isPullOnlyAuthoritative: boolean;
}

/**
 * The task changes one poll pulls for one item, or null when there is nothing
 * to apply. A row-level marker (CalDAV's ETag, Plainspace's `updatedAt`) moves
 * for any field, so a field is pulled only when its own remote value differs
 * from its baseline in `issueLastSyncedValues`: a local edit still waiting to
 * be pushed is not overwritten by an unrelated remote change. A field without
 * a baseline is pulled.
 */
export const computeFieldPullChanges = ({
  task,
  issueValues,
  wasUpdated,
  addTaskData,
  fieldMappings,
  syncConfig,
  ctx,
  isPullOnlyAuthoritative,
}: FieldPullInput): Partial<Task> | null => {
  const taskChanges: Record<PropertyKey, unknown> = wasUpdated ? { ...addTaskData } : {};
  const lastSyncedValues = task.issueLastSyncedValues ?? {};
  let hasPullOnlyMismatch = false;

  for (const mapping of fieldMappings) {
    const direction = syncConfig[mapping.taskField] ?? mapping.defaultDirection;

    if (!canPull(direction)) {
      delete taskChanges[mapping.taskField];
      continue;
    }

    const remoteTaskValue = mapping.toTaskValue(issueValues[mapping.issueField], ctx);
    const isRemoteChanged =
      !Object.prototype.hasOwnProperty.call(lastSyncedValues, mapping.issueField) ||
      !issueValuesEqual(
        issueValues[mapping.issueField],
        lastSyncedValues[mapping.issueField],
      );
    const shouldPullAfterMarkerChange =
      (isPullOnlyAuthoritative && direction === 'pullOnly') || isRemoteChanged;
    if (wasUpdated) {
      if (shouldPullAfterMarkerChange) {
        taskChanges[mapping.taskField] = remoteTaskValue;
      } else {
        delete taskChanges[mapping.taskField];
      }
    } else if (
      // Older refreshes could advance the marker without applying mapped values.
      // Heal provider-owned fields, but preserve possible unpushed edits in "both".
      isPullOnlyAuthoritative &&
      direction === 'pullOnly' &&
      remoteTaskValue !== task[mapping.taskField]
    ) {
      taskChanges[mapping.taskField] = remoteTaskValue;
      hasPullOnlyMismatch = true;
    }
  }

  return wasUpdated || hasPullOnlyMismatch ? (taskChanges as Partial<Task>) : null;
};

/**
 * Whether any pullable field's remote value differs from its baseline (or a
 * field has none while the task has a baseline). For a provider whose marker
 * can be advanced past changes that were never pulled: a marker taken from our
 * own write's answer counts that answer's other changes as seen (server side
 * effects such as a recurring item's next occurrence, or a collaborator's edit
 * that landed just before).
 */
export const hasRemoteFieldChange = (
  task: Task,
  issueValues: Record<string, unknown>,
  fieldMappings: FieldMapping[],
  syncConfig: FieldSyncConfig,
): boolean => {
  const lastSyncedValues = task.issueLastSyncedValues;
  // Without any baseline there is nothing to compare; the marker decides.
  if (!lastSyncedValues) {
    return false;
  }
  return fieldMappings.some((mapping) => {
    const direction = syncConfig[mapping.taskField] ?? mapping.defaultDirection;
    if (!canPull(direction)) {
      return false;
    }
    const remoteValue = issueValues[mapping.issueField];
    return Object.prototype.hasOwnProperty.call(lastSyncedValues, mapping.issueField)
      ? !issueValuesEqual(remoteValue, lastSyncedValues[mapping.issueField])
      : remoteValue !== undefined;
  });
};

/**
 * Local edits still waiting to be pushed, as task changes (task field → current
 * value): pushable fields whose local value differs from their baseline. With
 * `issueValues` (a fresh remote item) only fields whose remote value still
 * equals the baseline count; a field changed on both sides is the remote's
 * (it is pulled instead). The stored baseline is the queue, so this survives
 * restarts without an outbox.
 */
export const computePendingLocalChanges = (
  task: Task,
  fieldMappings: FieldMapping[],
  syncConfig: FieldSyncConfig,
  ctx: FieldMappingContext,
  issueValues?: Record<string, unknown>,
): Partial<Task> => {
  const lastSyncedValues = task.issueLastSyncedValues;
  const pending: Record<PropertyKey, unknown> = {};
  if (!lastSyncedValues) {
    return pending;
  }
  // Like the push decisions, the first mapping of a remote field decides it
  // (e.g. a time, before a day-only plan that maps onto the same field).
  const decidedIssueFields = new Set<string>();
  for (const mapping of fieldMappings) {
    if (decidedIssueFields.has(mapping.issueField)) {
      continue;
    }
    const direction = syncConfig[mapping.taskField] ?? mapping.defaultDirection;
    // Unlike `computePushDecisions`, a key missing from the baseline (an
    // `undefined` JSON dropped on its way here) is not pending. Read as
    // undefined, CalDAV's empty note ('' locally, undefined remotely) would
    // count as pending and a Retry would write an empty description. So an
    // offline edit of such a field isn't queued; its next direct edit pushes it.
    if (
      !canPush(direction) ||
      !Object.prototype.hasOwnProperty.call(lastSyncedValues, mapping.issueField)
    ) {
      continue;
    }
    decidedIssueFields.add(mapping.issueField);
    const baseline = lastSyncedValues[mapping.issueField];
    if (issueValues && !issueValuesEqual(issueValues[mapping.issueField], baseline)) {
      continue;
    }
    const localValue = task[mapping.taskField];
    if (!issueValuesEqual(mapping.toIssueValue(localValue, ctx), baseline)) {
      pending[mapping.taskField] = localValue;
    }
  }
  return pending as Partial<Task>;
};
