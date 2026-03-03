import { FieldMapping, FieldMappingContext, FieldSyncConfig } from './issue-sync.model';

export interface PushDecision {
  field: string;
  action: 'push' | 'skip';
  issueValue?: unknown;
  reason?: string;
}

export const computePushDecisions = (
  changedTaskFields: Record<string, unknown>,
  fieldMappings: FieldMapping[],
  syncConfig: FieldSyncConfig,
  freshIssueValues: Record<string, unknown>,
  lastSyncedValues: Record<string, unknown>,
  ctx: FieldMappingContext,
): PushDecision[] => {
  const decisions: PushDecision[] = [];

  for (const mapping of fieldMappings) {
    if (!(mapping.taskField in changedTaskFields)) {
      continue;
    }

    const direction = syncConfig[mapping.taskField] ?? mapping.defaultDirection;
    if (direction !== 'pushOnly' && direction !== 'both') {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reason: `direction is '${direction}'`,
      });
      continue;
    }

    if (!(mapping.issueField in lastSyncedValues)) {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reason: 'no baseline (first sync)',
      });
      continue;
    }

    if (freshIssueValues[mapping.issueField] !== lastSyncedValues[mapping.issueField]) {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reason: 'provider changed (provider wins)',
      });
      continue;
    }

    decisions.push({
      field: mapping.issueField,
      action: 'push',
      issueValue: mapping.toIssueValue(changedTaskFields[mapping.taskField], ctx),
    });
  }

  return decisions;
};
