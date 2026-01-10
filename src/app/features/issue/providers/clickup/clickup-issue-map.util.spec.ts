import { ClickUpTaskReduced, ClickUpTask } from './clickup-issue.model';
import { mapClickUpTaskToTask, isClickUpTaskDone } from './clickup-issue-map.util';
import typia from 'typia';

const mockIssueReduced: ClickUpTaskReduced = {
  ...typia.random<ClickUpTaskReduced>(),
  id: 'abc',
  name: 'Test Task',
  custom_id: '123',
  status: {
    ...typia.random<ClickUpTaskReduced['status']>(),
    status: 'open',
    type: 'open',
    color: '#000',
  },
  date_updated: '1600000000000',
};

const mockIssue: ClickUpTask = {
  ...typia.random<ClickUpTask>(),
  ...mockIssueReduced,
  date_created: '1500000000000',
  assignees: [],
  tags: [],
  attachments: [],
};

describe('mapClickUpTaskToTask', () => {
  it('should map correctly', () => {
    const result = mapClickUpTaskToTask(mockIssue);
    expect(result.title).toBe('Test Task');
    expect(result.issueLastUpdated).toBe(1600000000000);
    expect(result.isDone).toBe(false);
  });

  it('should map correctly without custom_id', () => {
    const issueWithoutId = { ...mockIssue, custom_id: undefined };
    const result = mapClickUpTaskToTask(issueWithoutId);
    expect(result.title).toBe('Test Task');
  });
});

describe('isClickUpTaskDone', () => {
  it('should be open for open status', () => {
    expect(isClickUpTaskDone(mockIssueReduced)).toBe(false);
  });

  it('should be done for closed status type', () => {
    const closedIssue = {
      ...mockIssueReduced,
      status: { ...mockIssueReduced.status, type: 'closed' },
    };
    expect(isClickUpTaskDone(closedIssue)).toBe(true);
  });

  it('should be done for closed status name', () => {
    const closedIssue = {
      ...mockIssueReduced,
      status: { ...mockIssueReduced.status, status: 'closed' },
    };
    expect(isClickUpTaskDone(closedIssue)).toBe(true);
  });
});
