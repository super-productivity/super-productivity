import { createActionGroup } from '@ngrx/store';
import { ADD_TASK_PANEL_ID } from '../planner.model';
import { TaskCopy } from '../../tasks/task.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

/* eslint-disable @typescript-eslint/naming-convention */

export const PlannerActions = createActionGroup({
  source: 'Planner',
  events: {
    'Upsert Planner Day': (plannerProps: { day: string; taskIds: string[] }) => ({
      ...plannerProps,
      meta: {
        isPersistent: true,
        entityType: 'PLANNER',
        entityId: plannerProps.day,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    // Internal cleanup action - no persistence
    'Cleanup Old And Undefined Planner Tasks': (plannerProps: {
      today: string;
      allTaskIds: string[];
    }) => ({
      ...plannerProps,
    }),

    'Transfer Task': (plannerProps: {
      task: TaskCopy;
      prevDay: string | typeof ADD_TASK_PANEL_ID;
      newDay: string | typeof ADD_TASK_PANEL_ID;
      targetIndex: number;
      targetTaskId?: string;
      today: string;
    }) => ({
      ...plannerProps,
      meta: {
        isPersistent: true,
        entityType: 'PLANNER',
        entityId: plannerProps.task.id,
        opType: OpType.Move,
      } satisfies PersistentActionMeta,
    }),

    'Move In List': (plannerProps: {
      targetDay: string;
      fromIndex: number;
      toIndex: number;
    }) => ({
      ...plannerProps,
      meta: {
        isPersistent: true,
        entityType: 'PLANNER',
        entityId: plannerProps.targetDay,
        opType: OpType.Move,
      } satisfies PersistentActionMeta,
    }),

    'Move Before Task': (plannerProps: { fromTask: TaskCopy; toTaskId: string }) => ({
      ...plannerProps,
      meta: {
        isPersistent: true,
        entityType: 'PLANNER',
        entityId: plannerProps.fromTask.id,
        opType: OpType.Move,
      } satisfies PersistentActionMeta,
    }),

    'Plan Task for Day': (plannerProps: {
      task: TaskCopy;
      day: string;
      isAddToTop?: boolean;
      isShowSnack?: boolean;
    }) => ({
      ...plannerProps,
      meta: {
        isPersistent: true,
        entityType: 'PLANNER',
        entityId: plannerProps.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    // UI state action - no persistence
    'Update Planner Dialog Last Shown': (plannerProps: { today: string }) => ({
      ...plannerProps,
    }),
  },
});
