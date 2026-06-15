import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { IssueProviderKey } from '../../issue.model';
import { PlainspaceIssue } from './plainspace-issue.model';

export const PLAINSPACE_ISSUE_CONTENT_CONFIG: IssueContentConfig<PlainspaceIssue> = {
  issueType: 'PLAINSPACE' as IssueProviderKey,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      type: IssueFieldType.LINK,
      value: (issue: PlainspaceIssue) => issue.title,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: PlainspaceIssue) => issue.assignee?.name ?? '',
      isVisible: (issue: PlainspaceIssue) => !!issue.assignee,
    },
  ],
};
