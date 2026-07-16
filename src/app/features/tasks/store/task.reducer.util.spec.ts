import { Update } from '@ngrx/entity';
import { INBOX_PROJECT } from '../../project/project.const';
import { _resetDevErrorState } from '../../../util/dev-error';
import { DEFAULT_TASK, Task, TaskState } from '../task.model';
import {
  deleteTaskHelper,
  getTaskById,
  removeTaskFromParentSideEffects,
  updateDoneOnForTask,
  updateTimeEstimateForTask,
  updateTimeSpentForTask,
} from './task.reducer.util';

const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  id,
  title: `Task ${id}`,
  created: 1,
  projectId: INBOX_PROJECT.id,
  ...partial,
});

const createState = (tasks: Task[], currentTaskId: string | null = null): TaskState => ({
  ids: tasks.map((task) => task.id),
  entities: tasks.reduce(
    (acc, task) => {
      acc[task.id] = task;
      return acc;
    },
    {} as Record<string, Task>,
  ),
  currentTaskId,
  selectedTaskId: null,
  taskDetailTargetPanel: null,
  lastCurrentTaskId: null,
  isDataLoaded: true,
});

describe('task.reducer.util', () => {
  const DAY_1 = '2025-01-01';
  const DAY_2 = '2025-01-02';
  const DAY_3 = '2025-01-03';

  describe('getTaskById', () => {
    it('should return task when id exists', () => {
      const task = createTask('t1');
      const state = createState([task]);

      expect(getTaskById('t1', state)).toEqual(task);
    });

    it('should throw when id does not exist', () => {
      const state = createState([]);

      expect(() => getTaskById('missing', state)).toThrowError('Task not found: missing');
    });
  });

  describe('updateDoneOnForTask', () => {
    it('should set doneOn using explicit payload timestamp when task is completed', () => {
      const task = createTask('t1', { isDone: false, doneOn: undefined });
      const state = createState([task]);
      const upd: Update<Task> = {
        id: 't1',
        changes: { isDone: true, doneOn: 123456789 },
      };

      const result = updateDoneOnForTask(upd, state);

      expect(result.entities['t1']?.doneOn).toBe(123456789);
    });

    it('should clear doneOn when task is marked undone', () => {
      const task = createTask('t1', { isDone: true, doneOn: 5555 });
      const state = createState([task]);
      const upd: Update<Task> = { id: 't1', changes: { isDone: false } };

      const result = updateDoneOnForTask(upd, state);

      expect(result.entities['t1']?.doneOn).toBeUndefined();
    });

    it('should keep state unchanged when update does not toggle done state', () => {
      const task = createTask('t1', { title: 'Before' });
      const state = createState([task]);
      const upd: Update<Task> = { id: 't1', changes: { title: 'After' } };

      const result = updateDoneOnForTask(upd, state);

      expect(result).toBe(state);
    });
  });

  describe('updateTimeSpentForTask', () => {
    it('should update child and incrementally roll up parent times', () => {
      const parent = createTask('parent', {
        subTaskIds: ['child'],
        timeSpentOnDay: { [DAY_1]: 30, [DAY_2]: 5 },
        timeSpent: 35,
      });
      const child = createTask('child', {
        parentId: 'parent',
        timeSpentOnDay: { [DAY_1]: 30, [DAY_2]: 5 },
        timeSpent: 35,
      });
      const state = createState([parent, child]);

      const result = updateTimeSpentForTask('child', { [DAY_1]: 10, [DAY_3]: 20 }, state);

      expect(result.entities['child']?.timeSpent).toBe(30);
      expect(result.entities['child']?.timeSpentOnDay).toEqual({
        [DAY_1]: 10,
        [DAY_3]: 20,
      });
      expect(result.entities['parent']?.timeSpent).toBe(30);
      expect(result.entities['parent']?.timeSpentOnDay).toEqual({
        [DAY_1]: 10,
        [DAY_3]: 20,
      });
    });
  });

  describe('updateTimeEstimateForTask', () => {
    it('should recalculate parent estimate when subtask done state changes', () => {
      const parent = createTask('parent', { subTaskIds: ['child'], timeEstimate: 70 });
      const child = createTask('child', {
        parentId: 'parent',
        isDone: false,
        timeEstimate: 100,
        timeSpent: 30,
      });
      const state = createState([parent, child]);
      const upd: Update<Task> = { id: 'child', changes: { isDone: true } };

      const result = updateTimeEstimateForTask(upd, null, state);

      expect(result.entities['parent']?.timeEstimate).toBe(0);
    });

    it('should update estimate and include it in parent recalculation', () => {
      const parent = createTask('parent', { subTaskIds: ['child'], timeEstimate: 10 });
      const child = createTask('child', {
        parentId: 'parent',
        isDone: false,
        timeEstimate: 10,
        timeSpent: 0,
      });
      const state = createState([parent, child]);
      const upd: Update<Task> = { id: 'child', changes: {} };

      const result = updateTimeEstimateForTask(upd, 90, state);

      expect(result.entities['child']?.timeEstimate).toBe(90);
      expect(result.entities['parent']?.timeEstimate).toBe(90);
    });
  });

  describe('deleteTaskHelper', () => {
    beforeEach(() => {
      _resetDevErrorState();
      if (jasmine.isSpy(window.alert)) {
        (window.alert as jasmine.Spy).and.stub();
      } else {
        spyOn(window, 'alert').and.stub();
      }
      if (jasmine.isSpy(window.confirm)) {
        (window.confirm as jasmine.Spy).and.returnValue(false);
      } else {
        spyOn(window, 'confirm').and.returnValue(false);
      }
    });

    it('should delete payload and orphan subtasks and clear current selection', () => {
      const parent = createTask('parent', { subTaskIds: ['sub1'] });
      const payloadSubTask = createTask('sub1', { parentId: 'parent' });
      const orphanSubTask = createTask('sub2', { parentId: 'parent' });
      const state = createState([parent, payloadSubTask, orphanSubTask], 'sub2');

      const result = deleteTaskHelper(state, parent);

      expect(result.entities['parent']).toBeUndefined();
      expect(result.entities['sub1']).toBeUndefined();
      expect(result.entities['sub2']).toBeUndefined();
      expect(result.currentTaskId).toBeNull();
    });
  });

  describe('removeTaskFromParentSideEffects', () => {
    it('should copy subtask times to parent when last subtask is removed', () => {
      const parent = createTask('parent', {
        subTaskIds: ['sub1'],
        timeSpentOnDay: {},
        timeEstimate: 0,
      });
      const subTask = createTask('sub1', {
        parentId: 'parent',
        timeSpentOnDay: { [DAY_1]: 42 },
        timeEstimate: 123,
      });
      const state = createState([parent, subTask]);

      const result = removeTaskFromParentSideEffects(state, subTask, true);

      expect(result.entities['parent']?.subTaskIds).toEqual([]);
      expect(result.entities['parent']?.timeSpentOnDay).toEqual({ [DAY_1]: 42 });
      expect(result.entities['parent']?.timeEstimate).toBe(123);
    });
  });
});
