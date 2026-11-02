import { Task } from '../../tasks/task.model';
import { FieldMapping, FieldMappingContext, FieldSyncConfig } from './issue-sync.model';

/** Why a `skip` decision was emitted. Stable codes that consumers can branch on. */
export type PushDecisionSkipReason =
  | 'direction-skip'
  | 'no-baseline'
  | 'provider-changed'
  | 'unchanged';

export interface PushDecision {
  field: string;
  action: 'push' | 'skip';
  issueValue?: unknown;
  /** Present only on `skip` decisions. */
  reasonCode?: PushDecisionSkipReason;
  /** Human-readable detail (for logging only — never branch on this). */
  reason?: string;
}

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
};

/**
 * Shallow equality for issue-field values (booleans, strings, numbers, or
 * string arrays like tagIds). Exported so the two-way-sync effect can detect
 * un-pulled remote changes with the exact same semantics used here.
 */
export const issueValuesEqual = valuesEqual;

export const computePushDecisions = (
  changedTaskFields: Record<string, unknown>,
  fieldMappings: FieldMapping[],
  syncConfig: FieldSyncConfig,
  freshIssueValues: Record<string, unknown>,
  lastSyncedValues: Record<string, unknown>,
  ctx: FieldMappingContext,
): PushDecision[] => {
  const decisions: PushDecision[] = [];
  const decidedIssueFields = new Set<string>();
  // A missing key of a baseline that exists was an `undefined` value: JSON
  // drops it when the baseline syncs to my other devices (#9776). Only no
  // baseline at all means a first sync.
  const hasBaseline = Object.keys(lastSyncedValues).length > 0;
  const mappingByTaskField = new Map(fieldMappings.map((m) => [m.taskField, m]));

  for (const mapping of fieldMappings) {
    if (decidedIssueFields.has(mapping.issueField)) {
      continue;
    }

    if (!(mapping.taskField in changedTaskFields)) {
      continue;
    }

    const direction = syncConfig[mapping.taskField] ?? mapping.defaultDirection;
    if (direction !== 'pushOnly' && direction !== 'both') {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reasonCode: 'direction-skip',
        reason: `direction is '${direction}'`,
      });
      decidedIssueFields.add(mapping.issueField);
      continue;
    }

    if (!hasBaseline) {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reasonCode: 'no-baseline',
        reason: 'no baseline (first sync)',
      });
      decidedIssueFields.add(mapping.issueField);
      continue;
    }

    if (
      !valuesEqual(
        freshIssueValues[mapping.issueField],
        lastSyncedValues[mapping.issueField],
      )
    ) {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reasonCode: 'provider-changed',
        reason: 'provider changed (provider wins)',
      });
      decidedIssueFields.add(mapping.issueField);
      continue;
    }

    const issueValue = mapping.toIssueValue(changedTaskFields[mapping.taskField], ctx);
    if (valuesEqual(issueValue, freshIssueValues[mapping.issueField])) {
      // Already the provider's value (e.g. short syntax left the title as it
      // was): writing it again would only add a no-op edit there.
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reasonCode: 'unchanged',
        reason: 'provider already has this value',
      });
      decidedIssueFields.add(mapping.issueField);
      continue;
    }

    decisions.push({ field: mapping.issueField, action: 'push', issueValue });
    decidedIssueFields.add(mapping.issueField);

    // Clear mutually exclusive fields on the remote
    for (const exclTaskField of mapping.mutuallyExclusive ?? []) {
      const exclMapping = mappingByTaskField.get(exclTaskField);
      // A field this change also reports is decided by its own mapping (a
      // day-only short syntax reports the cleared time and the new day).
      if (
        !exclMapping ||
        decidedIssueFields.has(exclMapping.issueField) ||
        exclMapping.taskField in changedTaskFields
      ) {
        continue;
      }
      const exclDir = syncConfig[exclMapping.taskField] ?? exclMapping.defaultDirection;
      if (exclDir !== 'pushOnly' && exclDir !== 'both') {
        continue;
      }
      decisions.push({
        field: exclMapping.issueField,
        action: 'push',
        issueValue: exclMapping.toIssueValue(undefined, ctx),
      });
      decidedIssueFields.add(exclMapping.issueField);
    }
  }

  return decisions;
};

/**
 * Task fields the baseline write may carry. It is an `updateTaskUi`: a plain
 * field update that no effect and no task meta-reducer reacts to, so writing
 * one again (`isDone` too) completes, schedules or notifies nothing. `tagIds`
 * and the due fields are left out: their lists (tag task ids, planner days,
 * Today's order) are kept by the meta-reducers this write skips.
 */
const VALUE_CARRY_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'notes',
  'timeEstimate',
  'isDone',
]);

/**
 * The task's own values of the fields just pushed, for the write that moves
 * their baseline to the pushed value (#11034). Field-level LWW resolves a
 * concurrent edit per field, so a baseline written alone can win over an
 * older write of its field while that field keeps another device's newer
 * value: the field then differs from its baseline and the next poll pushes it,
 * reverting the provider. Written together, field and baseline win or lose
 * together. A field whose value no longer maps to what was pushed (edited
 * again meanwhile) is left out, so a newer local edit is never overwritten.
 * Write the result with the baseline in one `updateTaskUi`.
 */
export const pushedValuesToCarry = (
  task: Task | undefined,
  pushedIssueValues: Record<string, unknown>,
  fieldMappings: FieldMapping[],
  ctx: FieldMappingContext,
): Partial<Task> => {
  const carried: Record<string, unknown> = {};
  if (!task) {
    return carried as Partial<Task>;
  }
  for (const mapping of fieldMappings) {
    if (
      !VALUE_CARRY_FIELDS.has(mapping.taskField) ||
      !Object.prototype.hasOwnProperty.call(pushedIssueValues, mapping.issueField)
    ) {
      continue;
    }
    const localValue = task[mapping.taskField];
    if (
      valuesEqual(
        mapping.toIssueValue(localValue, ctx),
        pushedIssueValues[mapping.issueField],
      )
    ) {
      carried[mapping.taskField] = localValue;
      if (mapping.taskField === 'isDone') {
        // The completion date belongs to the done state (cleared on a reopen).
        carried['doneOn'] = task.doneOn;
      }
    }
  }
  return carried as Partial<Task>;
};
