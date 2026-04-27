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
 * Atomically place `taskId` into `sectionId` at the position implied by
 * `afterTaskId`. The reducer enforces uniqueness:
 * - If `sourceSectionId` is a non-null string different from `sectionId`,
 *   the task is stripped from there explicitly and meta sets
 *   `entityIds: [src, dest]` so vector-clock conflict detection covers
 *   both sections. Replay is deterministic from the payload alone.
 * - If `sourceSectionId === sectionId` (intra-section reorder) or `null`
 *   (just-created task), the reducer skips the strip step and meta
 *   falls back to single-entity `entityId: sectionId`.
 * - If `sourceSectionId` is omitted entirely (legacy callers), the
 *   reducer falls back to a defensive sweep over all sections.
 *
 * RESIDUAL: under concurrent moves of the same task to different sections
 * across devices, the task may end up in multiple sections after sync
 * because each per-section update applies independently. A future fix
 * could either model membership as `task.sectionId` (atomic per-task) or
 * use a Phase 6.5 cleanup pass. See review notes.
 */
export const addTaskToSection = createAction(
  '[Section] Add Task to Section',
  (payload: {
    sectionId: string;
    taskId: string;
    afterTaskId?: string | null;
    sourceSectionId?: string | null;
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
