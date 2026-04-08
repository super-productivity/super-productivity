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
  const decidedIssueFields = new Set<string>();
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
        reason: `direction is '${direction}'`,
      });
      decidedIssueFields.add(mapping.issueField);
      continue;
    }

    if (!(mapping.issueField in lastSyncedValues)) {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reason: 'no baseline (first sync)',
      });
      decidedIssueFields.add(mapping.issueField);
      continue;
    }

    if (freshIssueValues[mapping.issueField] !== lastSyncedValues[mapping.issueField]) {
      decisions.push({
        field: mapping.issueField,
        action: 'skip',
        reason: 'provider changed (provider wins)',
      });
      decidedIssueFields.add(mapping.issueField);
      continue;
    }

    decisions.push({
      field: mapping.issueField,
      action: 'push',
      issueValue: mapping.toIssueValue(changedTaskFields[mapping.taskField], ctx),
    });
    decidedIssueFields.add(mapping.issueField);

    // Clear mutually exclusive fields on the remote
    for (const exclTaskField of mapping.mutuallyExclusive ?? []) {
      const exclMapping = mappingByTaskField.get(exclTaskField);
      if (!exclMapping || decidedIssueFields.has(exclMapping.issueField)) {
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
