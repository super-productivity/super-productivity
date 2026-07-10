/**
 * Moves the subset of `idsToMove` that pass `isValidId` to the front of
 * `allIds`, preserving their relative order, while leaving the remaining ids
 * in their original order. Shared by removeTasksFromTodayTag and
 * localRemoveOverdueFromToday in task.reducer.ts so tasks removed from Today
 * keep a stable position when they reappear (e.g. as overdue). See #6992.
 */
export interface MoveValidIdsToFrontResult {
  ids: string[];
  invalidCount: number;
}

export const moveValidIdsToFront = (
  allIds: string[],
  idsToMove: string[],
  isValidId: (id: string) => boolean,
): MoveValidIdsToFrontResult => {
  const validIds = idsToMove.filter(isValidId);
  return {
    ids: [...validIds, ...allIds.filter((id) => !idsToMove.includes(id))],
    invalidCount: idsToMove.length - validIds.length,
  };
};
