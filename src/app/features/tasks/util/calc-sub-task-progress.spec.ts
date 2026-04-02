import { Task } from '../task.model';

import { calcSubTaskProgress } from './calc-sub-task-progress';

describe('calcSubTaskProgress', () => {
  const createSubTask = (isDone: boolean): Task => ({ isDone }) as Task;

  it('should return zero for no subtasks', () => {
    expect(calcSubTaskProgress([])).toBe(0);
  });

  it('should return zero when no subtasks are done', () => {
    expect(calcSubTaskProgress([createSubTask(false), createSubTask(false)])).toBe(0);
  });

  it('should return partial completion percentage', () => {
    expect(
      calcSubTaskProgress([
        createSubTask(true),
        createSubTask(false),
        createSubTask(false),
        createSubTask(true),
      ]),
    ).toBe(50);
  });

  it('should return one hundred when all subtasks are done', () => {
    expect(calcSubTaskProgress([createSubTask(true), createSubTask(true)])).toBe(100);
  });
});
