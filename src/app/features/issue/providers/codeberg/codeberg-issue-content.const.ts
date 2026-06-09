import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { CodebergIssue } from './codeberg-issue.model';

export const CODEBERG_ISSUE_CONTENT_CONFIG: IssueContentConfig<CodebergIssue> = {
  issueType: 'CODEBERG' as const,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      type: IssueFieldType.LINK,
      value: (issue: CodebergIssue) => `${issue.title} #${issue.number}`,
      getLink: (issue: CodebergIssue) => issue.html_url,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      value: 'state',
      type: IssueFieldType.TEXT,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: CodebergIssue) =>
        issue.assignees?.map((a) => a.login || a.username).join(', '),
      isVisible: (issue: CodebergIssue) => (issue.assignees?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.LABELS,
      value: 'labels',
      type: IssueFieldType.CHIPS,
      isVisible: (issue: CodebergIssue) => (issue.labels?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: 'body',
      type: IssueFieldType.MARKDOWN,
      isVisible: (issue: CodebergIssue) => !!issue.body,
    },
  ],
  comments: {
    field: 'comments',
    authorField: 'user.login',
    bodyField: 'body',
    createdField: 'created_at',
    sortField: 'created_at',
  },
  getIssueUrl: (issue: CodebergIssue) => issue.url,
  hasCollapsingComments: true,
};
