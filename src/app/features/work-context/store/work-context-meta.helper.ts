import { DropListModelSource } from '../../tasks/task.model';
import { filterOutId } from '../../../util/filter-out-id';

/**
 * Moves an item to a position after the specified anchor.
 * Used for anchor-based positioning which is more sync-friendly than full list replacement.
 *
 * @param itemId - The item to move
 * @param afterItemId - The item to place after (null = move to start)
 * @param currentList - The current list of IDs
 * @returns The updated list with the item in its new position
 */
export const moveItemAfterAnchor = (
  itemId: string,
  afterItemId: string | null,
  currentList: string[],
): string[] => {
  // Remove the item from its current position
  const listWithoutItem = currentList.filter((id) => id !== itemId);

  if (afterItemId === null) {
    // Move to start
    return [itemId, ...listWithoutItem];
  }

  const anchorIndex = listWithoutItem.indexOf(afterItemId);
  if (anchorIndex === -1) {
    // Anchor not found - append to end as fallback
    // This handles the case where the anchor was deleted concurrently
    return [...listWithoutItem, itemId];
  }

  // Insert after the anchor
  const result = [...listWithoutItem];
  result.splice(anchorIndex + 1, 0, itemId);
  return result;
};

/**
 * Extracts the anchor ID from a drag-drop event's new ordered list.
 * The anchor is the item immediately before the moved item in the new list.
 *
 * @param itemId - The item that was moved
 * @param newOrderedIds - The list after the drag-drop operation
 * @returns The ID of the item before the moved item, or null if moving to start
 */
export const getAnchorFromDragDrop = (
  itemId: string,
  newOrderedIds: string[],
): string | null => {
  const newIndex = newOrderedIds.indexOf(itemId);
  if (newIndex <= 0) {
    return null;
  }
  return newOrderedIds[newIndex - 1];
};

export const moveTaskForWorkContextLikeState = (
  taskId: string,
  newOrderedIds: string[],
  target: DropListModelSource | null,
  taskIdsBefore: string[],
): string[] => {
  const idsFilteredMoving = taskIdsBefore.filter(filterOutId(taskId));
  // NOTE: move to end of complete list for done tasks
  const emptyListVal = target === 'DONE' ? idsFilteredMoving.length : 0;
  return moveItemInList(taskId, idsFilteredMoving, newOrderedIds, emptyListVal);
};

/*
We use this function because the dom list provided by the drag & drop event, might not
be the same as actual list, because items might be sorted differently (done/undone) or
items might be hidden (done sub tasks).
Please note that the completeList depending on the circumstances might or might not
include the itemId, while the partialList always should.
*/
export const moveItemInList = (
  itemId: string,
  completeList: string[],
  partialList: string[],
  emptyListVal = 0,
): string[] => {
  // Log.log(itemId, completeList, partialList);

  let newIndex;
  const curInUpdateListIndex = partialList.indexOf(itemId);
  const prevItemId = partialList[curInUpdateListIndex - 1];
  const nextItemId = partialList[curInUpdateListIndex + 1];
  const newCompleteListWithoutItem = completeList.filter((id) => id !== itemId);

  if (!partialList.includes(itemId)) {
    throw new Error('Drop Model Error');
  }

  if (!itemId) {
    throw new Error('Drop Model Error');
    // } else if (newCompleteListWithoutItem.length === 0) {
    //   newIndex = 0;
  } else if (prevItemId) {
    newIndex = newCompleteListWithoutItem.indexOf(prevItemId) + 1;
  } else if (nextItemId) {
    newIndex = newCompleteListWithoutItem.indexOf(nextItemId);
  } else if (partialList.length === 1) {
    newIndex = emptyListVal;
  } else {
    throw new Error('Drop Model Error');
  }

  const newCompleteList = [...newCompleteListWithoutItem];
  // NOTE: splice does NOT return the updated array... :/
  newCompleteList.splice(newIndex, 0, itemId);

  return newCompleteList;
};
