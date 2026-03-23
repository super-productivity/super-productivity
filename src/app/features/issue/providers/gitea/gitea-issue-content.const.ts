import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { GiteaIssue } from './gitea-issue.model';

export const GITEA_ISSUE_CONTENT_CONFIG: IssueContentConfig<GiteaIssue> = {
  issueType: 'GITEA' as const,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      type: IssueFieldType.LINK,
      value: (issue: GiteaIssue) => `${issue.title} #${issue.number}`,
      getLink: (issue: GiteaIssue) => issue.html_url,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      value: 'state',
      type: IssueFieldType.TEXT,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: GiteaIssue) =>
        issue.assignees?.map((a) => a.login || a.username).join(', '),
      isVisible: (issue: GiteaIssue) => (issue.assignees?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.LABELS,
      value: 'labels',
      type: IssueFieldType.CHIPS,
      isVisible: (issue: GiteaIssue) => (issue.labels?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: 'body',
      type: IssueFieldType.MARKDOWN,
      isVisible: (issue: GiteaIssue) => !!issue.body,
    },
  ],
  comments: {
    field: 'comments',
    authorField: 'user.login',
    bodyField: 'body',
    createdField: 'created_at',
    sortField: 'created_at',
  },
  getIssueUrl: (issue: GiteaIssue) => issue.url,
  hasCollapsingComments: true,
};
