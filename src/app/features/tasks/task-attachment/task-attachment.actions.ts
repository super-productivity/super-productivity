import { Update } from '@ngrx/entity';
import { TaskAttachment } from './task-attachment.model';
import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

// NOTE: all is handled in task reducer too
export const addTaskAttachment = createAction(
  '[TaskAttachment] Add TaskAttachment',
  (attachmentProps: { taskId: string; taskAttachment: TaskAttachment }) => ({
    ...attachmentProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: attachmentProps.taskId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const updateTaskAttachment = createAction(
  '[TaskAttachment] Update TaskAttachment',
  (attachmentProps: { taskId: string; taskAttachment: Update<TaskAttachment> }) => ({
    ...attachmentProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: attachmentProps.taskId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteTaskAttachment = createAction(
  '[TaskAttachment] Delete TaskAttachment',
  (attachmentProps: { taskId: string; id: string }) => ({
    ...attachmentProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: attachmentProps.taskId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
