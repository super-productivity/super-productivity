import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { TrashedItem, TrashEntityType } from '../trash.model';

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Trash actions.
 *
 * NOTE: Trash is currently a LOCAL-ONLY feature for MVP — actions are not
 * persisted to the op-log and do not sync across devices. Each client maintains
 * its own trash bin. A future iteration can add a TrashOperationHandler to sync
 * trash contents; see trash-lld.md Section 9.
 */
export const TrashActions = createActionGroup({
  source: 'Trash',
  events: {
    /** Move one or more items into the trash. */
    'Move To Trash': props<{ items: TrashedItem[] }>(),

    /** Restore a single item from the trash back to its original location. */
    'Restore From Trash': props<{ itemId: string; entityType: TrashEntityType }>(),

    /** Permanently delete items from the trash (no restore possible). */
    'Permanently Delete From Trash': props<{ itemIds: string[] }>(),

    /** Permanently delete everything in the trash. */
    'Empty Trash': emptyProps(),

    /** Hydrate the in-memory trash state from IndexedDB. */
    'Load Trash Success': props<{ items: TrashedItem[] }>(),
  },
});
