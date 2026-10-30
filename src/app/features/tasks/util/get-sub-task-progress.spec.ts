import { getSubTaskProgress } from './get-sub-task-progress';

describe('getSubTaskProgress', () => {
  const sub = (isDone: boolean): { isDone: boolean } => ({ isDone });

  it('should return null without sub tasks', () => {
    expect(getSubTaskProgress(undefined)).toBeNull();
    expect(getSubTaskProgress(null)).toBeNull();
    expect(getSubTaskProgress([])).toBeNull();
  });

  it('should count zero done when no sub task is done', () => {
    expect(getSubTaskProgress([sub(false), sub(false)])).toEqual({ done: 0, total: 2 });
  });

  it('should count partially done sub tasks', () => {
    expect(getSubTaskProgress([sub(true), sub(false), sub(false), sub(true)])).toEqual({
      done: 2,
      total: 4,
    });
  });

  it('should count all done sub tasks', () => {
    expect(getSubTaskProgress([sub(true), sub(true)])).toEqual({ done: 2, total: 2 });
  });
});
