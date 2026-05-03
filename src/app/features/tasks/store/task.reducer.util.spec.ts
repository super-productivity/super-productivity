import { Update } from '@ngrx/entity';
import { Task, TaskState } from '../task.model';
import { initialTaskState } from './task.reducer';
import { updateDoneOnForTask } from './task.reducer.util';
import { INBOX_PROJECT } from '../../project/project.const';

describe('task.reducer.util', () => {
  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    created: Date.now(),
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    projectId: INBOX_PROJECT.id,
    parentId: undefined,
    timeSpentOnDay: {},
    timeEstimate: 0,
    timeSpent: 0,
    dueDay: undefined,
    dueWithTime: undefined,
    attachments: [],
    ...partial,
  });

  const createState = (tasks: Task[]): TaskState => {
    const entities: Record<string, Task> = {};
    tasks.forEach((t) => {
      entities[t.id] = t;
    });
    return {
      ...initialTaskState,
      ids: tasks.map((t) => t.id),
      entities,
    };
  };

  describe('updateDoneOnForTask', () => {
    const todayStr = '2026-05-03';

    it('should set doneOn and dueDay when marking task as done', () => {
      const task = createTask('task1', { isDone: false });
      const state = createState([task]);
      const upd: Update<Task> = { id: 'task1', changes: { isDone: true } };

      const result = updateDoneOnForTask(upd, state, todayStr);

      expect(result.entities['task1']?.doneOn).toBeDefined();
      expect(result.entities['task1']?.dueDay).toBe(todayStr);
    });

    it('should clear dueWithTime when marking task as done before scheduled time', () => {
      // Task is scheduled for 1 hour in the future, completing now (early)
      const dueWithTime = Date.now() + 3600000;
      const task = createTask('task1', { isDone: false, dueWithTime });
      const state = createState([task]);
      const upd: Update<Task> = { id: 'task1', changes: { isDone: true } };

      const result = updateDoneOnForTask(upd, state, todayStr);

      expect(result.entities['task1']?.dueWithTime).toBeUndefined();
    });

    it('should clear doneOn when marking task as undone', () => {
      const task = createTask('task1', { isDone: true, doneOn: Date.now() });
      const state = createState([task]);
      const upd: Update<Task> = { id: 'task1', changes: { isDone: false } };

      const result = updateDoneOnForTask(upd, state, todayStr);

      expect(result.entities['task1']?.doneOn).toBeUndefined();
    });

    it('should return unchanged state if isDone is not in changes', () => {
      const task = createTask('task1', { isDone: false });
      const state = createState([task]);
      const upd: Update<Task> = { id: 'task1', changes: { title: 'New Title' } };

      const result = updateDoneOnForTask(upd, state, todayStr);

      expect(result).toBe(state);
    });

    describe('dueWithTime preservation on task completion', () => {
      it('should preserve dueWithTime when task is completed on or after scheduled time', () => {
        // Task was scheduled for 1 second ago, completing now (on time or late)
        const dueWithTime = Date.now() - 1000;
        const task = createTask('task1', { isDone: false, dueWithTime });
        const state = createState([task]);
        const upd: Update<Task> = { id: 'task1', changes: { isDone: true } };

        const result = updateDoneOnForTask(upd, state, todayStr);

        // dueWithTime should be preserved
        expect(result.entities['task1']?.dueWithTime).toBe(dueWithTime);
      });

      it('should clear dueWithTime when task is completed before scheduled time', () => {
        // Task is scheduled for 1 hour in the future, completing now (early)
        const dueWithTime = Date.now() + 3600000;
        const task = createTask('task1', { isDone: false, dueWithTime });
        const state = createState([task]);
        const upd: Update<Task> = { id: 'task1', changes: { isDone: true } };

        const result = updateDoneOnForTask(upd, state, todayStr);

        // dueWithTime should be cleared for early completion
        expect(result.entities['task1']?.dueWithTime).toBeUndefined();
      });

      it('should preserve dueWithTime when task is completed exactly at scheduled time', () => {
        // Task is scheduled for now, completing now
        const dueWithTime = Date.now();
        const task = createTask('task1', { isDone: false, dueWithTime });
        const state = createState([task]);
        const upd: Update<Task> = { id: 'task1', changes: { isDone: true } };

        const result = updateDoneOnForTask(upd, state, todayStr);

        // dueWithTime should be preserved
        expect(result.entities['task1']?.dueWithTime).toBe(dueWithTime);
      });
    });
  });
});
