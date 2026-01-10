import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { ClickUpTask } from './clickup-issue.model';

export const CLICKUP_ISSUE_CONTENT_CONFIG: IssueContentConfig<ClickUpTask> = {
  issueType: 'CLICKUP' as const,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      type: IssueFieldType.LINK,
      value: (issue: ClickUpTask) => issue.name,
      getLink: (issue: ClickUpTask) => issue.url,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      value: (issue: ClickUpTask) => issue.status.status,
      type: IssueFieldType.TEXT,
      isVisible: (issue: ClickUpTask) => !!issue.status,
    },
    {
      label: 'Priority',
      value: (issue: ClickUpTask) => issue.priority?.priority,
      type: IssueFieldType.TEXT,
      isVisible: (issue: ClickUpTask) => !!issue.priority,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: ClickUpTask) => issue.assignees?.map((a) => a.username).join(', '),
      isVisible: (issue: ClickUpTask) => (issue.assignees?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.LABELS,
      value: (issue: ClickUpTask) => issue.tags?.map((t) => t.name).join(', '),
      type: IssueFieldType.TEXT,
      isVisible: (issue: ClickUpTask) => (issue.tags?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: (issue: ClickUpTask) => issue.markdown_description,
      type: IssueFieldType.MARKDOWN,
      isVisible: (issue: ClickUpTask) => !!issue.markdown_description,
    },
    // TODO: Add comments (activity)
  ],
  getIssueUrl: (issue) => issue.url,
};
