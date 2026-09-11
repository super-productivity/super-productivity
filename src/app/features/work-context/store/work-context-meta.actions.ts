// Shared actions for tags and projects
//
// NOTE on `doneTaskIds`: despite the name, the field carries the ids of the
// NOT-done tasks in the context (see selectUndoneTaskIdsForActiveContext) —
// the move-up/down reducers skip neighbors absent from it. These are
// persistent ops replayed by released clients, so the payload field name is
// wire-frozen; renaming it would break replay on the shipped fleet.
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
    /** Wire-frozen name: carries the NOT-done ids. See the file header. */
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
    /** Wire-frozen name: carries the NOT-done ids. See the file header. */
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
    /** Wire-frozen name: carries the NOT-done ids. See the file header. */
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
    /** Wire-frozen name: carries the NOT-done ids. See the file header. */
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
