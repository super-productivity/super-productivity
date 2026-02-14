import {
  IssueContentConfig,
  IssueFieldType,
} from '../../../issue-content/issue-content.model';
import { AzureDevOpsIssue } from './azure-devops-issue.model';
import { T } from '../../../../../t.const';

export const AZURE_DEVOPS_ISSUE_CONTENT_CONFIG: IssueContentConfig<AzureDevOpsIssue> = {
  issueType: 'AZURE_DEVOPS',
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      type: IssueFieldType.MARKDOWN,
      value: (issue: AzureDevOpsIssue) => issue.description,
      isVisible: (issue: AzureDevOpsIssue) => !!issue.description,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      type: IssueFieldType.TEXT,
      value: (issue: AzureDevOpsIssue) => issue.status,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: AzureDevOpsIssue) => issue.assignee,
      isVisible: (issue: AzureDevOpsIssue) => !!issue.assignee,
    },
  ],
};
