import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { ForgejoIssue } from './forgejo-issue.model';

export const FORGEJO_ISSUE_CONTENT_CONFIG: IssueContentConfig<ForgejoIssue> = {
  issueType: 'FORGEJO' as const,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      type: IssueFieldType.LINK,
      value: (issue: ForgejoIssue) => `${issue.title} #${issue.number}`,
      getLink: (issue: ForgejoIssue) => issue.html_url,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      value: 'state',
      type: IssueFieldType.TEXT,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: ForgejoIssue) =>
        issue.assignees?.map((a) => a.login || a.username).join(', '),
      isVisible: (issue: ForgejoIssue) => (issue.assignees?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.LABELS,
      value: 'labels',
      type: IssueFieldType.CHIPS,
      isVisible: (issue: ForgejoIssue) => (issue.labels?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: 'body',
      type: IssueFieldType.MARKDOWN,
      isVisible: (issue: ForgejoIssue) => !!issue.body,
    },
  ],
  comments: {
    field: 'comments',
    authorField: 'user.login',
    bodyField: 'body',
    createdField: 'created_at',
    sortField: 'created_at',
  },
  getIssueUrl: (issue: ForgejoIssue) => issue.url,
  hasCollapsingComments: true,
};
