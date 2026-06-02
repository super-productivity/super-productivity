import { Task } from '../task.model';
import {
  canApplyConvertToSubTask,
  canConvertTaskToSubTask,
} from './can-convert-task-to-sub-task';

// An eligible top-level task: every guard field empty.
const eligible = (): Parameters<typeof canConvertTaskToSubTask>[0] => ({
  parentId: undefined,
  subTaskIds: [],
  repeatCfgId: undefined,
  issueId: undefined,
  issueProviderId: undefined,
  issueType: undefined,
  dueWithTime: undefined,
  reminderId: undefined,
  remindAt: undefined,
});

describe('canConvertTaskToSubTask', () => {
  it('accepts a plain top-level task with no blocking fields', () => {
    expect(canConvertTaskToSubTask(eligible())).toBe(true);
  });

  it('rejects a task that is already a subtask', () => {
    expect(canConvertTaskToSubTask({ ...eligible(), parentId: 'p1' })).toBe(false);
  });

  it('rejects a task that already has subtasks', () => {
    expect(canConvertTaskToSubTask({ ...eligible(), subTaskIds: ['s1'] })).toBe(false);
  });

  it('rejects a repeating task', () => {
    expect(canConvertTaskToSubTask({ ...eligible(), repeatCfgId: 'r1' })).toBe(false);
  });

  it('rejects an issue-provider task', () => {
    expect(canConvertTaskToSubTask({ ...eligible(), issueId: 'i1' })).toBe(false);
    expect(canConvertTaskToSubTask({ ...eligible(), issueProviderId: 'ip1' })).toBe(
      false,
    );
    expect(
      canConvertTaskToSubTask({
        ...eligible(),
        issueType: 'JIRA' as Task['issueType'],
      }),
    ).toBe(false);
  });

  it('rejects a scheduled / reminder task', () => {
    expect(canConvertTaskToSubTask({ ...eligible(), dueWithTime: 1234 })).toBe(false);
    expect(canConvertTaskToSubTask({ ...eligible(), reminderId: 'rem1' })).toBe(false);
    expect(canConvertTaskToSubTask({ ...eligible(), remindAt: 1234 })).toBe(false);
  });
});

describe('canApplyConvertToSubTask', () => {
  const task = { ...eligible(), id: 't1' };
  const parent: Pick<Task, 'id' | 'parentId'> = { id: 'p1', parentId: undefined };

  it('accepts an eligible task onto a valid top-level parent', () => {
    expect(canApplyConvertToSubTask(task, parent)).toBe(true);
  });

  it('rejects when the task is missing', () => {
    expect(canApplyConvertToSubTask(undefined, parent)).toBe(false);
  });

  it('rejects when the target parent is missing', () => {
    expect(canApplyConvertToSubTask(task, undefined)).toBe(false);
  });

  it('rejects self-nesting', () => {
    expect(
      canApplyConvertToSubTask(
        { ...task, id: 'same' },
        { id: 'same', parentId: undefined },
      ),
    ).toBe(false);
  });

  it('rejects nesting under a task that is itself a subtask', () => {
    expect(canApplyConvertToSubTask(task, { id: 'p1', parentId: 'grandparent' })).toBe(
      false,
    );
  });

  it('rejects an ineligible task (already a subtask)', () => {
    expect(canApplyConvertToSubTask({ ...task, parentId: 'x' }, parent)).toBe(false);
  });
});
