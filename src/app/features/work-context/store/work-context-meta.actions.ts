// Shared actions for tags and projects
import { createAction } from '@ngrx/store';
import { DropListModelSource } from '../../tasks/task.model';
import { WorkContextType } from '../work-context.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const moveTaskInTodayList = createAction(
  '[WorkContextMeta] Move Task in Today',
  (taskProps: {
    taskId: string;
    afterTaskId: string | null;
    workContextType: WorkContextType;
    workContextId: string;
    src: DropListModelSource;
    target: DropListModelSource;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: taskProps.workContextType === 'TAG' ? 'TAG' : 'PROJECT',
      entityId: taskProps.workContextId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveTaskUpInTodayList = createAction(
  '[WorkContextMeta] Move Task Up in Today',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneTaskIds: string[];
    workContextType: WorkContextType;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: taskProps.workContextType === 'TAG' ? 'TAG' : 'PROJECT',
      entityId: taskProps.workContextId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveTaskDownInTodayList = createAction(
  '[WorkContextMeta] Move Task Down in Today',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneTaskIds: string[];
    workContextType: WorkContextType;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: taskProps.workContextType === 'TAG' ? 'TAG' : 'PROJECT',
      entityId: taskProps.workContextId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveTaskToTopInTodayList = createAction(
  '[WorkContextMeta] Move Task To Top in Today',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneTaskIds: string[];
    workContextType: WorkContextType;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: taskProps.workContextType === 'TAG' ? 'TAG' : 'PROJECT',
      entityId: taskProps.workContextId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveTaskToBottomInTodayList = createAction(
  '[WorkContextMeta] Move Task To Bottom in Today',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneTaskIds: string[];
    workContextType: WorkContextType;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: taskProps.workContextType === 'TAG' ? 'TAG' : 'PROJECT',
      entityId: taskProps.workContextId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);
