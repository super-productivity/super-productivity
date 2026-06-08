import { isBlankTask } from './is-blank-task';
import { Task, TaskWithSubTasks } from '../task.model';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    title: '',
    projectId: 'project-1',
    tagIds: [],
    subTaskIds: [],
    parentId: undefined,
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    notes: '',
    attachments: [],
    created: Date.now(),
    ...overrides,
  }) as Task;

const createTaskWithSubTasks = (
  overrides: Partial<TaskWithSubTasks> = {},
): TaskWithSubTasks => ({
  ...createTask(),
  subTasks: [],
  ...overrides,
});

describe('isBlankTask', () => {
  it('should be true for a freshly created task with an empty title', () => {
    expect(isBlankTask(createTaskWithSubTasks())).toBe(true);
  });

  it('should be true when the title is only whitespace', () => {
    expect(isBlankTask(createTaskWithSubTasks({ title: '   ' }))).toBe(true);
  });

  it('should ignore context-derived fields (tagIds, projectId)', () => {
    expect(
      isBlankTask(
        createTaskWithSubTasks({ tagIds: ['some-tag'], projectId: 'other-project' }),
      ),
    ).toBe(true);
  });

  it('should be false when the task has a title', () => {
    expect(isBlankTask(createTaskWithSubTasks({ title: 'Real task' }))).toBe(false);
  });

  it('should be false when the task has notes', () => {
    expect(isBlankTask(createTaskWithSubTasks({ notes: 'some note' }))).toBe(false);
  });

  it('should be false when time was tracked', () => {
    expect(isBlankTask(createTaskWithSubTasks({ timeSpent: 1000 }))).toBe(false);
  });

  it('should be false when a time estimate is set', () => {
    expect(isBlankTask(createTaskWithSubTasks({ timeEstimate: 60000 }))).toBe(false);
  });

  it('should be false when the task has attachments', () => {
    expect(
      isBlankTask(
        createTaskWithSubTasks({
          attachments: [{ id: 'a', type: 'LINK', title: 't', path: 'p' }],
        }),
      ),
    ).toBe(false);
  });

  it('should be false when the task is linked to an issue', () => {
    expect(isBlankTask(createTaskWithSubTasks({ issueId: 'issue-1' }))).toBe(false);
  });

  it('should be false when the task has a reminder', () => {
    expect(isBlankTask(createTaskWithSubTasks({ reminderId: 'reminder-1' }))).toBe(false);
  });

  it('should be false when the task has a repeat config', () => {
    expect(isBlankTask(createTaskWithSubTasks({ repeatCfgId: 'repeat-1' }))).toBe(false);
  });

  it('should be false when the task is scheduled', () => {
    expect(isBlankTask(createTaskWithSubTasks({ dueWithTime: Date.now() }))).toBe(false);
    expect(isBlankTask(createTaskWithSubTasks({ dueDay: '2026-05-22' }))).toBe(false);
  });

  it('should be false when the task has a deadline', () => {
    expect(isBlankTask(createTaskWithSubTasks({ deadlineDay: '2026-05-22' }))).toBe(
      false,
    );
    expect(isBlankTask(createTaskWithSubTasks({ deadlineWithTime: Date.now() }))).toBe(
      false,
    );
  });

  it('should be false for a parent task with a sub task that has data', () => {
    expect(
      isBlankTask(
        createTaskWithSubTasks({
          subTasks: [createTask({ id: 'sub-1', title: 'Sub task' })],
        }),
      ),
    ).toBe(false);
  });

  it('should be true for a parent task whose sub tasks are all blank', () => {
    expect(
      isBlankTask(
        createTaskWithSubTasks({
          subTasks: [createTask({ id: 'sub-1' }), createTask({ id: 'sub-2' })],
        }),
      ),
    ).toBe(true);
  });
});
