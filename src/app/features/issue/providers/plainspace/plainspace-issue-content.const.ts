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
      getLink: (issue: PlainspaceIssue) => issue.url || '',
    },
  ],
};
