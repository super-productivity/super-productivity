import { T } from '../../../../t.const';
import { IssueFieldType } from '../../issue-content/issue-content.model';
import { JIRA_ISSUE_CONTENT_CONFIG } from './jira-issue-content.const';
import { JiraIssue } from './jira-issue.model';

const makeIssue = (priority?: JiraIssue['priority']): JiraIssue =>
  ({
    key: 'SP-42',
    summary: 'Fix the thing',
    status: { name: 'In Progress' },
    priority,
  }) as unknown as JiraIssue;

describe('JIRA_ISSUE_CONTENT_CONFIG', () => {
  it('shows priority after status when Jira provides one', () => {
    const statusIndex = JIRA_ISSUE_CONTENT_CONFIG.fields.findIndex(
      (field) => field.label === T.F.ISSUE.ISSUE_CONTENT.STATUS,
    );
    const priorityIndex = JIRA_ISSUE_CONTENT_CONFIG.fields.findIndex(
      (field) => field.label === T.F.ISSUE.ISSUE_CONTENT.PRIORITY,
    );
    const priorityField = JIRA_ISSUE_CONTENT_CONFIG.fields[priorityIndex];
    const issue = makeIssue({
      self: '',
      id: '2',
      iconUrl: '',
      name: 'High',
    });

    expect(priorityIndex).toBe(statusIndex + 1);
    expect(priorityField.type).toBe(IssueFieldType.TEXT);
    expect(priorityField.isVisible?.(issue)).toBe(true);
    expect(typeof priorityField.value).toBe('function');
    expect((priorityField.value as (issue: JiraIssue) => unknown)(issue)).toBe('High');
  });

  it('hides priority when Jira does not provide one', () => {
    const priorityField = JIRA_ISSUE_CONTENT_CONFIG.fields.find(
      (field) => field.label === T.F.ISSUE.ISSUE_CONTENT.PRIORITY,
    );

    expect(priorityField?.isVisible?.(makeIssue(null))).toBe(false);
  });
});
