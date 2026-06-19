import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { IssueProviderKey } from '../../issue.model';
import { PlainspaceIssue } from './plainspace-issue.model';

export const PLAINSPACE_ISSUE_CONTENT_CONFIG: IssueContentConfig<PlainspaceIssue> = {
  issueType: 'PLAINSPACE' as IssueProviderKey,
  // Title, done state and schedule are mirrored onto the SP task itself, so the
  // panel would only echo them. Surface just what the task doesn't already show:
  // whether it recurs in Plainspace, and a link back to open it there.
  fields: [
    {
      label: T.PLAINSPACE.RECURRING,
      // Render the same `repeat` mat-icon the claim pool uses (a plain text value
      // cell can't hold an icon and isn't translated).
      type: IssueFieldType.CUSTOM,
      customTemplate: 'plainspace-recurring',
      value: 'isRecurring',
      isVisible: (issue: PlainspaceIssue) => issue.isRecurring,
    },
    {
      label: T.PLAINSPACE.OPEN_IN_PLAINSPACE,
      type: IssueFieldType.LINK,
      value: (issue: PlainspaceIssue) => issue.title,
      getLink: (issue: PlainspaceIssue) => issue.url || '',
      isVisible: (issue: PlainspaceIssue) => !!issue.url,
    },
  ],
};
