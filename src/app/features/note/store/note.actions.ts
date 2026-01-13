import { createAction } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Note } from '../note.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const updateNoteOrder = createAction(
  '[Note] Update Note Order',
  (noteProps: {
    ids: string[];
    activeContextType: WorkContextType;
    activeContextId: string;
  }) => ({
    ...noteProps,
    meta: {
      isPersistent: true,
      entityType: 'NOTE',
      entityIds: noteProps.ids,
      opType: OpType.Move,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const addNote = createAction(
  '[Note] Add Note',
  (noteProps: { note: Note; isPreventFocus?: boolean }) => ({
    ...noteProps,
    meta: {
      isPersistent: true,
      entityType: 'NOTE',
      entityId: noteProps.note.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const updateNote = createAction(
  '[Note] Update Note',
  (noteProps: { note: Update<Note> }) => ({
    ...noteProps,
    meta: {
      isPersistent: true,
      entityType: 'NOTE',
      entityId: noteProps.note.id as string,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteNote = createAction(
  '[Note] Delete Note',
  (noteProps: { id: string; projectId: string | null; isPinnedToToday: boolean }) => ({
    ...noteProps,
    meta: {
      isPersistent: true,
      entityType: 'NOTE',
      entityId: noteProps.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const moveNoteToOtherProject = createAction(
  '[Note] Move to other project',
  (noteProps: { note: Note; targetProjectId: string }) => ({
    ...noteProps,
    meta: {
      isPersistent: true,
      entityType: 'NOTE',
      entityId: noteProps.note.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
