import { Dictionary } from '@ngrx/entity';
import { DEFAULT_TASK, Task } from '../task.model';
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

  it('allows a top-level task that already has subtasks', () => {
    expect(canConvertTaskToSubTask({ ...eligible(), subTaskIds: ['s1'] })).toBe(true);
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

  const mkEntity = (
    id: string,
    parentId: string | undefined,
    subTaskIds: string[] = [],
  ): Task => ({ ...DEFAULT_TASK, id, parentId, subTaskIds, projectId: 'p' });

  it('accepts an eligible task onto a valid top-level parent', () => {
    const entities: Dictionary<Task> = {
      t1: mkEntity('t1', undefined),
      p1: mkEntity('p1', undefined),
    };
    expect(canApplyConvertToSubTask(task, parent, entities)).toBe(true);
  });

  it('rejects when the task is missing', () => {
    expect(canApplyConvertToSubTask(undefined, parent, {})).toBe(false);
  });

  it('rejects when the target parent is missing', () => {
    expect(canApplyConvertToSubTask(task, undefined, {})).toBe(false);
  });

  it('rejects self-nesting', () => {
    const entities: Dictionary<Task> = { same: mkEntity('same', undefined) };
    expect(
      canApplyConvertToSubTask(
        { ...task, id: 'same' },
        { id: 'same', parentId: undefined },
        entities,
      ),
    ).toBe(false);
  });

  it('allows nesting under a subtask when within max depth (#2657)', () => {
    // gp(1) → p1(2); nesting leaf t1 under p1 → depth 3, allowed
    const entities: Dictionary<Task> = {
      gp: mkEntity('gp', undefined, ['p1']),
      p1: mkEntity('p1', 'gp'),
      t1: mkEntity('t1', undefined),
    };
    expect(canApplyConvertToSubTask(task, { id: 'p1', parentId: 'gp' }, entities)).toBe(
      true,
    );
  });

  it('rejects nesting that would exceed max depth (#2657)', () => {
    // l1(1) → l2(2) → l3(3) → l4(4); nesting under l4 → depth 5, rejected
    const entities: Dictionary<Task> = {
      l1: mkEntity('l1', undefined, ['l2']),
      l2: mkEntity('l2', 'l1', ['l3']),
      l3: mkEntity('l3', 'l2', ['l4']),
      l4: mkEntity('l4', 'l3'),
      t1: mkEntity('t1', undefined),
    };
    expect(canApplyConvertToSubTask(task, { id: 'l4', parentId: 'l3' }, entities)).toBe(
      false,
    );
  });

  it('rejects a moved subtree that would exceed max depth (#2657)', () => {
    // target p1 is depth 2; moving t1 with height 3 would end at depth 5.
    const taskWithChildren = { ...task, subTaskIds: ['c1'] };
    const entities: Dictionary<Task> = {
      gp: mkEntity('gp', undefined, ['p1']),
      p1: mkEntity('p1', 'gp'),
      t1: mkEntity('t1', undefined, ['c1']),
      c1: mkEntity('c1', 't1', ['c2']),
      c2: mkEntity('c2', 'c1'),
    };
    expect(
      canApplyConvertToSubTask(taskWithChildren, { id: 'p1', parentId: 'gp' }, entities),
    ).toBe(false);
  });

  it('rejects an ineligible task (already a subtask)', () => {
    const entities: Dictionary<Task> = { p1: mkEntity('p1', undefined) };
    expect(canApplyConvertToSubTask({ ...task, parentId: 'x' }, parent, entities)).toBe(
      false,
    );
  });
});
