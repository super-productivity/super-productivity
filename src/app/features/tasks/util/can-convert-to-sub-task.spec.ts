import {
  canConvertTaskToSubTask,
  canShowEmptySubTaskDropTarget,
} from './can-convert-to-sub-task';
import { DEFAULT_TASK, Task } from '../task.model';

const task = (overrides: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  ...overrides,
  id: overrides.id ?? 'task1',
  projectId: overrides.projectId ?? '',
  subTaskIds: overrides.subTaskIds ?? [],
  tagIds: overrides.tagIds ?? [],
});
const SCHEDULED_AT = 1779144000000;
const blockedTaskCases: { label: string; overrides: Partial<Task> }[] = [
  { label: 'subtasks', overrides: { subTaskIds: ['child1'] } },
  { label: 'repeat config', overrides: { repeatCfgId: 'repeat1' } },
  { label: 'issue id', overrides: { issueId: 'issue1' } },
  { label: 'issue provider', overrides: { issueProviderId: 'github' } },
  { label: 'issue type', overrides: { issueType: 'GITHUB' } },
  { label: 'dueWithTime', overrides: { dueWithTime: SCHEDULED_AT } },
  { label: 'dueDay', overrides: { dueDay: '2026-05-19' } },
  { label: 'remindAt', overrides: { remindAt: SCHEDULED_AT } },
  { label: 'reminderId', overrides: { reminderId: 'reminder1' } },
];

describe('canConvertTaskToSubTask', () => {
  it('allows plain top-level tasks without children or external links', () => {
    expect(canConvertTaskToSubTask(task())).toBe(true);
  });

  blockedTaskCases.forEach(({ label, overrides }) => {
    it(`blocks tasks with ${label}`, () => {
      expect(canConvertTaskToSubTask(task(overrides))).toBe(false);
    });
  });
});

describe('canShowEmptySubTaskDropTarget', () => {
  it('shows the empty drop target when converting a plain top-level task', () => {
    const targetParent = task({ id: 'parent1' });
    const activeTask = task({ id: 'task1' });

    expect(canShowEmptySubTaskDropTarget(targetParent, activeTask, false)).toBe(true);
  });

  it('shows the empty drop target when reparenting a subtask to a childless parent', () => {
    const targetParent = task({ id: 'parent2' });
    const activeTask = task({ id: 'sub1', parentId: 'parent1' });

    expect(canShowEmptySubTaskDropTarget(targetParent, activeTask, false)).toBe(true);
  });

  it('does not show the empty drop target for the current parent', () => {
    const targetParent = task({ id: 'parent1' });
    const activeTask = task({ id: 'sub1', parentId: 'parent1' });

    expect(canShowEmptySubTaskDropTarget(targetParent, activeTask, false)).toBe(false);
  });

  it('does not show the empty drop target for scheduled top-level tasks', () => {
    const targetParent = task({ id: 'parent1' });
    const activeTask = task({ id: 'task1', dueDay: '2026-05-19' });

    expect(canShowEmptySubTaskDropTarget(targetParent, activeTask, false)).toBe(false);
  });
});
