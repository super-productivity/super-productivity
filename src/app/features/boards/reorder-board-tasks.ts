import { TaskCardMove } from '../tasks/task-card-list.token';

/** Move selected rows together without changing their relative order. */
export const reorderBoardTasks = (
  ids: readonly string[],
  selected: ReadonlySet<string>,
  direction: TaskCardMove,
): string[] => {
  if (direction === 'top' || direction === 'bottom') {
    const moving = ids.filter((id) => selected.has(id));
    const remaining = ids.filter((id) => !selected.has(id));
    return direction === 'top' ? [...moving, ...remaining] : [...remaining, ...moving];
  }
  const result = [...ids];
  const step = direction === 'up' ? 1 : -1;
  for (
    let i = step === 1 ? 1 : result.length - 2;
    i >= 0 && i < result.length;
    i += step
  ) {
    if (selected.has(result[i]) && !selected.has(result[i - step])) {
      [result[i], result[i - step]] = [result[i - step], result[i]];
    }
  }
  return result;
};
