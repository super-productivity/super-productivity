import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Task, TaskDetailTargetPanel } from '../task.model';
import { RoundTimeOption } from '../../project/project.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

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

export const __updateMultipleTaskSimple = createAction(
  '[Task] Update multiple Tasks (simple)',
  (taskProps: { taskUpdates: Update<Task>[]; isIgnoreShortSyntax?: boolean }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityIds: taskProps.taskUpdates.map((u) => u.id as string),
      opType: OpType.Update,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
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

export const moveSubTask = createAction(
  '[Task] Move sub task',
  (taskProps: {
    taskId: string;
    srcTaskId: string;
    targetTaskId: string;
    afterTaskId: string | null;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveSubTaskUp = createAction(
  '[Task] Move up',
  (taskProps: { id: string; parentId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.id,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveSubTaskDown = createAction(
  '[Task] Move down',
  (taskProps: { id: string; parentId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.id,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveSubTaskToTop = createAction(
  '[Task] Move to top',
  (taskProps: { id: string; parentId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.id,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveSubTaskToBottom = createAction(
  '[Task] Move to bottom',
  (taskProps: { id: string; parentId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.id,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const removeTimeSpent = createAction(
  '[Task] Remove time spent',
  (taskProps: { id: string; date: string; duration: number }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const addSubTask = createAction(
  '[Task] Add SubTask',
  (taskProps: { task: Task; parentId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.task.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const toggleStart = createAction('[Task] Toggle start');

export const roundTimeSpentForDay = createAction(
  '[Task] RoundTimeSpentForDay',
  (taskProps: {
    day: string;
    taskIds: string[];
    roundTo: RoundTimeOption;
    isRoundUp: boolean;
    projectId?: string | null;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityIds: taskProps.taskIds,
      opType: OpType.Update,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const addNewTagsFromShortSyntax = createAction(
  '[Task] Add new tags from short syntax',

  props<{
    taskId: string;
    newTitles: string[];
  }>(),
);
