import { createAction } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Tag } from '../tag.model';
import { WorkContextAdvancedCfgKey } from '../../work-context/work-context.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const addTag = createAction('[Tag] Add Tag', (tagProps: { tag: Tag }) => ({
  ...tagProps,
  meta: {
    isPersistent: true,
    entityType: 'TAG',
    entityId: tagProps.tag.id,
    opType: OpType.Create,
  } satisfies PersistentActionMeta,
}));

export const updateTag = createAction(
  '[Tag] Update Tag',
  (tagProps: { tag: Update<Tag>; isSkipSnack?: boolean }) => ({
    ...tagProps,
    meta: {
      isPersistent: true,
      entityType: 'TAG',
      entityId: tagProps.tag.id as string,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

/**
 * Payload marker stamped on every new single-tag `deleteTag` operation so the
 * LWW conflict planner gives it delete-wins precedence over a concurrent edit
 * of the same tag (#11489, ARCHITECTURE-DECISIONS.md #7). Released clients
 * ignore it and keep resolving the delete by timestamp. Shared with the sync
 * classifier (`conflict-resolution.util.ts`) so a rename is compiler-checked
 * on both ends. `deleteTags` deliberately carries no marker.
 */
export const TAG_DELETE_WINS_MARKER = 'tagDeleteWins';

export const deleteTag = createAction(
  '[Tag] Delete Tag',
  // Tag titles for the push-on-delete two-way-sync effect ride on
  // DeletedTagTitlesSidecarService — never in the action payload, so user
  // content stays out of the exportable op-log (rule 9).
  (tagProps: { id: string }) => ({
    ...tagProps,
    [TAG_DELETE_WINS_MARKER]: true as const,
    meta: {
      isPersistent: true,
      entityType: 'TAG',
      entityId: tagProps.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteTags = createAction(
  '[Tag] Delete multiple Tags',
  (tagProps: { ids: string[] }) => ({
    ...tagProps,
    meta: {
      isPersistent: true,
      entityType: 'TAG',
      entityIds: tagProps.ids,
      opType: OpType.Delete,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const updateTagOrder = createAction(
  '[Tag] Update Tag Order',
  (tagProps: { ids: string[] }) => ({
    ...tagProps,
    meta: {
      isPersistent: true,
      entityType: 'TAG',
      entityIds: tagProps.ids,
      opType: OpType.Move,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const updateAdvancedConfigForTag = createAction(
  '[Tag] Update Advanced Config',
  (tagProps: { tagId: string; sectionKey: WorkContextAdvancedCfgKey; data: any }) => ({
    ...tagProps,
    meta: {
      isPersistent: true,
      entityType: 'TAG',
      entityId: tagProps.tagId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
