/**
 * Validates that `id` is a member of `subTaskIds` before applying `moveFn` to
 * it. Shared by moveSubTaskUp/Down/ToTop/ToBottom in task.reducer.ts so each
 * action doesn't duplicate the same membership check.
 *
 * @returns the reordered list, or `null` if `id` is not a member of
 * `subTaskIds` (parent task not found, wrong parent, stale op-log entry, etc.)
 */
export const getReorderedSubTaskIds = (
  subTaskIds: string[] | undefined,
  id: string,
  moveFn: (ids: string[], id: string) => string[],
): string[] | null => {
  if (!subTaskIds || !subTaskIds.includes(id)) {
    return null;
  }
  return moveFn(subTaskIds, id);
};
