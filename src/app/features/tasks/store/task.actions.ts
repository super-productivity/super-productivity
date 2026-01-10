import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Task, TaskDetailTargetPanel } from '../task.model';
import { RoundTimeOption } from '../../project/project.model';

export const setCurrentTask = createAction(
  '[Task] SetCurrentTask',
  props<{
    id: string | null;
  }>(),
);

export const setSelectedTask = createAction(
  '[Task] SetSelectedTask',
  props<{
    id: string | null;
    taskDetailTargetPanel?: TaskDetailTargetPanel;
    isSkipToggle?: boolean;
  }>(),
);

export const unsetCurrentTask = createAction('[Task] UnsetCurrentTask');

export const addReminderIdToTask = createAction(
  '[Task] Add ReminderId to Task',
  props<{
    taskId: string;
    reminderId: string;
  }>(),
);

export const __updateMultipleTaskSimple = createAction(
  '[Task] Update multiple Tasks (simple)',
  props<{
    taskUpdates: Update<Task>[];
    isIgnoreShortSyntax?: boolean;
  }>(),
);

export const updateTaskUi = createAction(
  '[Task] Update Task Ui',
  props<{ task: Update<Task> }>(),
);

export const removeTagsForAllTasks = createAction(
  '[Task] Remove Tags from all Tasks',
  props<{ tagIdsToRemove: string[] }>(),
);

export const toggleTaskHideSubTasks = createAction(
  '[Task] Toggle Show Sub Tasks',
  props<{ taskId: string; isShowLess: boolean; isEndless: boolean }>(),
);

export const undoDeleteTask = createAction('[Task] Undo Delete Task');

export const moveSubTask = createAction(
  '[Task] Move sub task',
  props<{
    taskId: string;
    srcTaskId: string;
    targetTaskId: string;
    newOrderedIds: string[];
  }>(),
);

export const moveSubTaskUp = createAction(
  '[Task] Move up',

  props<{ id: string; parentId: string }>(),
);

export const moveSubTaskDown = createAction(
  '[Task] Move down',
  props<{ id: string; parentId: string }>(),
);

export const moveSubTaskToTop = createAction(
  '[Task] Move to top',

  props<{ id: string; parentId: string }>(),
);

export const moveSubTaskToBottom = createAction(
  '[Task] Move to bottom',

  props<{ id: string; parentId: string }>(),
);

export const removeTimeSpent = createAction(
  '[Task] Remove time spent',

  props<{ id: string; date: string; duration: number }>(),
);

export const removeReminderFromTask = createAction(
  '[Task] Remove Reminder',

  props<{
    id: string;
    reminderId: string;
    isSkipToast?: boolean;
    isLeaveDueTime?: boolean;
  }>(),
);

export const addSubTask = createAction(
  '[Task] Add SubTask',

  props<{ task: Task; parentId: string }>(),
);

export const toggleStart = createAction('[Task] Toggle start');

export const roundTimeSpentForDay = createAction(
  '[Task] RoundTimeSpentForDay',

  props<{
    day: string;
    taskIds: string[];
    roundTo: RoundTimeOption;
    isRoundUp: boolean;
    projectId?: string | null;
  }>(),
);

export const addNewTagsFromShortSyntax = createAction(
  '[Task] Add new tags from short syntax',

  props<{
    taskId: string;
    newTitles: string[];
  }>(),
);

export const makeTaskSubtaskOfAnother = createAction(
  '[Task] Make task subtask of another',
  props<{
    taskId: string;
    newParentId: string;
    newOrderedIds?: string[];
  }>(),
);

export const convertSubtaskToTask = createAction(
  '[Task] Convert subtask to task',
  props<{
    taskId: string;
    parentId: string;
  }>(),
);
