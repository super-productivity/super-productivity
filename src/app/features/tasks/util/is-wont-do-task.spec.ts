import { Task } from '../task.model';
import { getWontDoChanges, isCompletedTask, isWontDoTask } from './is-wont-do-task';

type DoneFields = Pick<Task, 'isDone' | 'doneOn' | 'wontDoOn'>;

/**
 * What every client, released ones included, does with a done toggle: a done
 * write stamps `doneOn` (the op's own, else now), an un-done write clears it,
 * and any other field, `wontDoOn` too, is merged as it is.
 */
const applyDoneToggle = (
  task: DoneFields,
  changes: Partial<DoneFields>,
  now: number,
): DoneFields => ({
  ...task,
  ...changes,
  ...(changes.isDone === true ? { doneOn: changes.doneOn ?? now } : {}),
  ...(changes.isDone === false ? { doneOn: undefined } : {}),
});

describe('is-wont-do-task', () => {
  describe('isWontDoTask', () => {
    it('is true for a done task whose wontDoOn matches its doneOn', () => {
      expect(isWontDoTask({ isDone: true, doneOn: 5, wontDoOn: 5 })).toBe(true);
    });

    it('is false for a plain completion', () => {
      expect(isWontDoTask({ isDone: true, doneOn: 5 })).toBe(false);
    });

    it('ignores a wontDoOn from an earlier finish', () => {
      expect(isWontDoTask({ isDone: true, doneOn: 9, wontDoOn: 5 })).toBe(false);
    });

    it('ignores wontDoOn on a task that is not done', () => {
      expect(isWontDoTask({ isDone: false, doneOn: 5, wontDoOn: 5 })).toBe(false);
      expect(isWontDoTask({ isDone: false, wontDoOn: 5 })).toBe(false);
    });

    it('is false for a done task without doneOn', () => {
      expect(isWontDoTask({ isDone: true, wontDoOn: 5 })).toBe(false);
    });
  });

  describe('isCompletedTask', () => {
    it('excludes wont do tasks', () => {
      expect(isCompletedTask({ isDone: true, doneOn: 5 })).toBe(true);
      expect(isCompletedTask({ isDone: true, doneOn: 9, wontDoOn: 5 })).toBe(true);
      expect(isCompletedTask({ isDone: true, doneOn: 5, wontDoOn: 5 })).toBe(false);
      expect(isCompletedTask({ isDone: false })).toBe(false);
    });
  });

  // A released client stores `wontDoOn` as a plain field and never clears it.
  describe('on a client that does not know wontDoOn', () => {
    it('finishes the task as wont do', () => {
      const task = applyDoneToggle({ isDone: false }, getWontDoChanges(1000), 1001);
      expect(isWontDoTask(task)).toBe(true);
    });

    it('leaves a completed task after wont do, reopen, complete', () => {
      let task: DoneFields = { isDone: false };
      task = applyDoneToggle(task, getWontDoChanges(1000), 1000);
      task = applyDoneToggle(task, { isDone: false }, 2000);
      expect(isWontDoTask(task)).toBe(false);
      task = applyDoneToggle(task, { isDone: true, doneOn: 3000 }, 3000);
      expect(task.wontDoOn).toBe(1000);
      expect(isWontDoTask(task)).toBe(false);
      expect(isCompletedTask(task)).toBe(true);
    });

    // e.g. an op from before capture stored `doneOn`, replayed later
    it('leaves a completed task when a done write carries no doneOn', () => {
      let task: DoneFields = applyDoneToggle(
        { isDone: false },
        getWontDoChanges(1000),
        1,
      );
      task = applyDoneToggle(task, { isDone: false }, 2000);
      task = applyDoneToggle(task, { isDone: true }, 3000);
      expect(isWontDoTask(task)).toBe(false);
    });
  });
});
