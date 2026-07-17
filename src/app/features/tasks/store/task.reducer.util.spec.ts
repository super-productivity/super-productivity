import { Update } from '@ngrx/entity';
import { Task, TaskState } from '../task.model';
import { taskAdapter } from './task.adapter';
import { initialTaskState } from './task.reducer';
import {
  deleteTaskHelper,
  removeTaskFromParentSideEffects,
  updateDoneOnForTask,
  updateStartDateForRepeatableTask,
  updateTimeEstimateForTask,
  updateTimeSpentForTask,
} from './task.reducer.util';
import { _resetDevErrorState } from '../../../util/dev-error';

describe('task.reducer.util', () => {
  const DAY_1 = '2026-07-10';
  const DAY_2 = '2026-07-11';
  const DAY_3 = '2026-07-12';

  const createTask = (id: string, partial: Partial<Task> = {}): Task =>
    ({
      id,
      title: id,
      projectId: 'INBOX',
      created: 1,
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
      ...partial,
    }) as Task;

  const createState = (
    tasks: Task[],
    currentTaskId: string | null = null,
  ): TaskState => ({
    ...taskAdapter.setAll(tasks, initialTaskState),
    currentTaskId,
  });

  describe('updateDoneOnForTask', () => {
    it('should use explicit doneOn timestamp when provided', () => {
      const state = createState([createTask('task-1')]);
      const upd: Update<Task> = {
        id: 'task-1',
        changes: { isDone: true, doneOn: 12345 },
      };

      const result = updateDoneOnForTask(upd, state);

      expect(result.entities['task-1']!.doneOn).toBe(12345);
    });

    it('should use Date.now when doneOn is not provided', () => {
      spyOn(Date, 'now').and.returnValue(777);
      const state = createState([createTask('task-1')]);
      const upd: Update<Task> = { id: 'task-1', changes: { isDone: true } };

      const result = updateDoneOnForTask(upd, state);

      expect(result.entities['task-1']!.doneOn).toBe(777);
    });

    it('should clear doneOn when task is marked undone', () => {
      const state = createState([createTask('task-1', { doneOn: 999, isDone: true })]);
      const upd: Update<Task> = { id: 'task-1', changes: { isDone: false } };

      const result = updateDoneOnForTask(upd, state);

      expect(result.entities['task-1']!.doneOn).toBeUndefined();
    });
  });

  describe('updateStartDateForRepeatableTask', () => {
    it('should mark repeatable task done and clear dueDay', () => {
      spyOn(Date, 'now').and.returnValue(4444);
      const state = createState([createTask('task-1', { dueDay: DAY_1 })]);

      const result = updateStartDateForRepeatableTask(
        { id: 'task-1', changes: { isDone: true } },
        state,
      );

      expect(result.entities['task-1']!.doneOn).toBe(4444);
      expect(result.entities['task-1']!.dueDay).toBeUndefined();
    });
  });

  describe('updateTimeSpentForTask', () => {
    it('should update parent time incrementally and remove zeroed days', () => {
      const state = createState([
        createTask('parent', {
          subTaskIds: ['child'],
          timeSpentOnDay: {
            [DAY_1]: 120,
            [DAY_2]: 30,
          },
          timeSpent: 150,
        }),
        createTask('child', {
          parentId: 'parent',
          timeSpentOnDay: {
            [DAY_1]: 120,
            [DAY_2]: 30,
          },
          timeSpent: 150,
        }),
      ]);

      const result = updateTimeSpentForTask(
        'child',
        {
          [DAY_1]: 90,
          [DAY_3]: 90,
        },
        state,
      );

      // net delta: -30 (DAY_1 down) -30 (DAY_2 zeroed) +90 (DAY_3 added) = +30
      // parent timeSpent must move off its starting 150 so the accumulator matters
      expect(result.entities['child']!.timeSpent).toBe(180);
      expect(result.entities['parent']!.timeSpent).toBe(180);
      expect(result.entities['parent']!.timeSpentOnDay).toEqual({
        [DAY_1]: 90,
        [DAY_3]: 90,
      });
    });

    it('should update task without touching parent data when task has no parent', () => {
      const state = createState([createTask('task-1')]);

      const result = updateTimeSpentForTask(
        'task-1',
        {
          [DAY_1]: 15,
          [DAY_2]: 45,
        },
        state,
      );

      expect(result.entities['task-1']!.timeSpent).toBe(60);
      expect(result.entities['task-1']!.timeSpentOnDay).toEqual({
        [DAY_1]: 15,
        [DAY_2]: 45,
      });
    });
  });

  describe('updateTimeEstimateForTask', () => {
    it('should recalculate parent estimate from remaining child work', () => {
      const state = createState([
        createTask('parent', { subTaskIds: ['child-1', 'child-2'], timeEstimate: 999 }),
        createTask('child-1', {
          parentId: 'parent',
          timeEstimate: 120,
          timeSpent: 20,
        }),
        createTask('child-2', {
          parentId: 'parent',
          timeEstimate: 200,
          timeSpent: 50,
        }),
      ]);

      const result = updateTimeEstimateForTask({ id: 'child-1', changes: {} }, 80, state);

      expect(result.entities['child-1']!.timeEstimate).toBe(80);
      expect(result.entities['parent']!.timeEstimate).toBe(210);
    });

    it('should exclude a child from parent estimate when marking it done', () => {
      const state = createState([
        createTask('parent', { subTaskIds: ['child-1', 'child-2'] }),
        createTask('child-1', {
          parentId: 'parent',
          timeEstimate: 120,
          timeSpent: 20,
          isDone: false,
        }),
        createTask('child-2', {
          parentId: 'parent',
          timeEstimate: 200,
          timeSpent: 50,
          isDone: false,
        }),
      ]);

      const result = updateTimeEstimateForTask(
        { id: 'child-1', changes: { isDone: true } },
        null,
        state,
      );

      expect(result.entities['parent']!.timeEstimate).toBe(150);
    });

    it('should clamp negative remaining work to zero during parent recalculation', () => {
      const state = createState([
        createTask('parent', { subTaskIds: ['child-1'] }),
        createTask('child-1', {
          parentId: 'parent',
          timeEstimate: 30,
          timeSpent: 90,
        }),
      ]);

      const result = updateTimeEstimateForTask({ id: 'child-1', changes: {} }, 30, state);

      expect(result.entities['parent']!.timeEstimate).toBe(0);
    });
  });

  describe('deleteTaskHelper', () => {
    it('should remove state-discovered orphan subtasks when deleting a parent task', () => {
      // `isShowAlert` latches off after the first devError of the whole Karma run,
      // and test.ts creates the window.alert spy once and never resets its call
      // history — so we must reset both before asserting devError fired.
      _resetDevErrorState();
      if (jasmine.isSpy(window.alert)) {
        (window.alert as jasmine.Spy).and.stub();
        (window.alert as jasmine.Spy).calls.reset();
      } else {
        spyOn(window, 'alert').and.stub();
      }
      if (jasmine.isSpy(window.confirm)) {
        (window.confirm as jasmine.Spy).and.returnValue(false);
      } else {
        spyOn(window, 'confirm').and.returnValue(false);
      }

      const parent = createTask('parent', { subTaskIds: [] });
      const orphanSubTask = createTask('orphan-sub', { parentId: 'parent' });
      const state = createState([parent, orphanSubTask], 'orphan-sub');

      const result = deleteTaskHelper(state, parent);

      expect(result.entities['parent']).toBeUndefined();
      expect(result.entities['orphan-sub']).toBeUndefined();
      expect(result.currentTaskId).toBeNull();
      expect(window.alert).toHaveBeenCalled();
    });
  });

  describe('removeTaskFromParentSideEffects', () => {
    it('should copy time values to parent when removing the last subtask with copy flag', () => {
      const taskToRemove = createTask('child', {
        parentId: 'parent',
        timeSpentOnDay: { [DAY_1]: 25 },
        timeEstimate: 80,
      });
      const state = createState([
        createTask('parent', {
          subTaskIds: ['child'],
          timeSpentOnDay: {},
          timeEstimate: 0,
        }),
        taskToRemove,
      ]);

      const result = removeTaskFromParentSideEffects(state, taskToRemove, true);

      expect(result.entities['parent']!.subTaskIds).toEqual([]);
      expect(result.entities['parent']!.timeSpentOnDay).toEqual({ [DAY_1]: 25 });
      expect(result.entities['parent']!.timeEstimate).toBe(80);
    });

    it('should recalculate parent totals instead of copying when other subtasks remain', () => {
      const state = createState([
        createTask('parent', {
          subTaskIds: ['child-1', 'child-2'],
          timeSpentOnDay: { [DAY_1]: 50 },
          timeEstimate: 999,
        }),
        createTask('child-1', {
          parentId: 'parent',
          timeSpentOnDay: { [DAY_1]: 20 },
          timeSpent: 20,
          timeEstimate: 40,
        }),
        createTask('child-2', {
          parentId: 'parent',
          timeSpentOnDay: { [DAY_1]: 30 },
          timeSpent: 30,
          timeEstimate: 100,
        }),
      ]);

      const result = removeTaskFromParentSideEffects(
        state,
        state.entities['child-1']!,
        true,
      );

      expect(result.entities['parent']!.subTaskIds).toEqual(['child-2']);
      expect(result.entities['parent']!.timeSpentOnDay).toEqual({ [DAY_1]: 30 });
      expect(result.entities['parent']!.timeSpent).toBe(30);
      expect(result.entities['parent']!.timeEstimate).toBe(70);
    });
  });
});
