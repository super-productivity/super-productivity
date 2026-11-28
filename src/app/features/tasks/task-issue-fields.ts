import type { IssueFieldsForTask } from './task.model';

export const UNLINKED_ISSUE_FIELDS = {
  issueId: undefined,
  issueProviderId: undefined,
  issueType: undefined,
  issueWasUpdated: undefined,
  issueLastUpdated: undefined,
  issueAttachmentNr: undefined,
  issueTimeTracked: undefined,
  issuePoints: undefined,
  issueLastSyncedValues: undefined,
} as const satisfies Record<keyof IssueFieldsForTask, undefined>;
