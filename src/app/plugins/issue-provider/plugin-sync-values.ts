import {
  IssueProviderPluginDefinition,
  PluginIssue,
} from './plugin-issue-provider.model';
import { sortTagLabels } from './plugin-tag-utils';

/**
 * The mapped issue fields' values, stored as `issueLastSyncedValues` and diffed
 * against on the next sync, so import, refresh and two-way sync must all use
 * this. Prefers the plugin's `extractSyncValues`, falling back to the raw field.
 */
export const extractPluginSyncValues = (
  definition: IssueProviderPluginDefinition,
  issue: PluginIssue,
): Record<string, unknown> => {
  const fieldMappings = definition.fieldMappings;
  if (!fieldMappings?.length) {
    return {};
  }

  const data = definition.extractSyncValues
    ? definition.extractSyncValues(issue)
    : (issue as Record<string, unknown>);
  const issueRecord = issue as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const mapping of fieldMappings) {
    const value = Object.prototype.hasOwnProperty.call(data, mapping.issueField)
      ? data[mapping.issueField]
      : issueRecord[mapping.issueField];
    if (value === undefined) {
      continue;
    }
    result[mapping.issueField] =
      mapping.taskField === 'tagIds' ? sortTagLabels(value) : value;
  }

  return result;
};
