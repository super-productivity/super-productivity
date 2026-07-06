import { HideSubTasksMode } from '../task.model';

/**
 * Computes the next `_hideSubTasksMode` value when cycling a task's subtask
 * collapse state.
 *
 * Extracted from the old `toggleTaskHideSubTasks` reducer so the *resolved
 * absolute value* can be persisted via `updateTaskUi` (which is replay-safe)
 * instead of persisting a relative toggle command. Replaying a relative
 * command recomputes from live state and is non-deterministic across devices.
 * See issue #8781.
 *
 * @param currentMode current `_hideSubTasksMode` (undefined = fully shown)
 * @param subTaskDoneCount number of currently-done subtasks
 * @param subTaskCount total number of subtasks
 * @param isShowLess step towards hiding more (true) or showing more (false)
 * @param isEndless wrap around the ends instead of clamping
 */
export const getNextHideSubTasksMode = (
  currentMode: HideSubTasksMode | undefined,
  subTaskDoneCount: number,
  subTaskCount: number,
  isShowLess: boolean,
  isEndless: boolean,
): HideSubTasksMode | undefined => {
  const isDoneTaskCaseNeeded = subTaskDoneCount > 0 && subTaskDoneCount < subTaskCount;
  // for easier calculations we use 0 instead of undefined for show state
  const oldVal = currentMode || 0;
  let newVal: number = isShowLess ? oldVal + 1 : oldVal - 1;

  if (!isDoneTaskCaseNeeded && newVal === 1) {
    if (isShowLess) {
      newVal = 2;
    } else {
      newVal = 0;
    }
  }

  if (isEndless) {
    if (newVal < 0) {
      newVal = 2;
    } else if (newVal > 2) {
      newVal = 0;
    }
  } else {
    if (newVal < 0) {
      newVal = 0;
    } else if (newVal > 2) {
      newVal = 2;
    }
  }

  return (newVal || undefined) as HideSubTasksMode | undefined;
};
