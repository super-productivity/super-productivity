import { createAction } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Section } from '../section.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';
import { WorkContextType } from '../../work-context/work-context.model';

export const addSection = createAction(
  '[Section] Add Section',
  (payload: { section: Section }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'SECTION',
      entityId: payload.section.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteSection = createAction(
  '[Section] Delete Section',
  (payload: { id: string }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'SECTION',
      entityId: payload.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const updateSection = createAction(
  '[Section] Update Section',
  (payload: { section: Update<Section> }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'SECTION',
      entityId: payload.section.id as string,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const updateSectionOrder = createAction(
  '[Section] Update Section Order',
  (payload: { contextId: string; ids: string[] }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'SECTION',
      entityIds: payload.ids,
      opType: OpType.Move,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

/**
 * Atomically place `taskId` into `sectionId` at `afterTaskId`.
 * `sourceSectionId` is part of the payload so replay is deterministic:
 * different from `sectionId` → strip from source (meta covers both via
 * `entityIds`); equal or `null` → single-entity update on `sectionId`.
 *
 * FOLLOW-UP: a `task.sectionId` membership model would atomize cross-
 * section moves and obviate most of section-shared.reducer.ts. Needs a
 * migration path for existing data — out of scope.
 */
export const addTaskToSection = createAction(
  '[Section] Add Task to Section',
  (payload: {
    sectionId: string;
    taskId: string;
    afterTaskId: string | null;
    sourceSectionId: string | null;
  }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'SECTION',
      ...(payload.sourceSectionId && payload.sourceSectionId !== payload.sectionId
        ? { entityIds: [payload.sourceSectionId, payload.sectionId] }
        : { entityId: payload.sectionId }),
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

/**
 * Remove `taskId` from `sectionId` and atomically reposition it in the
 * work-context's `taskIds` so it lands at the dropped slot in the
 * no-section bucket. The work-context reorder happens in
 * `sectionSharedMetaReducer` so a single op covers both state mutations
 * — partial replay can't leave the task half-moved.
 *
 * `workContextAfterTaskId` is the anchor in the WORK-CONTEXT taskIds
 * (project.taskIds or tag.taskIds), not the section's. `null` means
 * "place at the start of the no-section bucket". The op stays typed as
 * a SECTION update; the cross-feature mutation rides along the same
 * pattern as `TaskSharedActions.deleteTask` etc. in
 * section-shared.reducer.ts.
 *
 * FOLLOW-UP (simplicity): `removeTaskFromSection` and `addTaskToSection`
 * now carry near-identical anchor-style payloads. Folding them into one
 * action with a nullable `sectionId` would drop one action, one op-log
 * code (S6), one reducer branch, and one ACTION_HANDLERS entry. The
 * obstacles are an opType change (Move vs Update) and an op-log meta
 * migration — out of scope for this bug fix.
 */
export const removeTaskFromSection = createAction(
  '[Section] Remove Task from Section',
  (payload: {
    sectionId: string;
    taskId: string;
    workContextId: string;
    workContextType: WorkContextType;
    workContextAfterTaskId: string | null;
  }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'SECTION',
      entityId: payload.sectionId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
