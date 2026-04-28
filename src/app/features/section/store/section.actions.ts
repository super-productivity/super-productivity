import { createAction } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Section } from '../section.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

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
 * Remove `taskId` from `sectionId`. Used when a task is dragged out of a
 * section into the "no section" area. Persisted as an Update on the
 * source section so concurrent ungroups from different sections never
 * collide on a sentinel id (the prior 'NONE' approach).
 *
 * FOLLOW-UP (simplicity): this action duplicates a lot of
 * `addTaskToSection`. Folding it into `addTaskToSection` with a nullable
 * `sectionId` would drop one action, one op-log code (S6), and one
 * reducer branch. Held back because the two actions use different
 * opTypes (Move vs Update) and the meta-builder asymmetry would need
 * sync-replay validation. Out of scope for this PR.
 */
export const removeTaskFromSection = createAction(
  '[Section] Remove Task from Section',
  (payload: { sectionId: string; taskId: string }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'SECTION',
      entityId: payload.sectionId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
