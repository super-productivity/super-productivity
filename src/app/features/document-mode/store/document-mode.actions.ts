import { createAction, props } from '@ngrx/store';
import { DocumentBlock, DocumentBlocksDelta } from '../document-block.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

/**
 * Non-persistent action for immediate local state updates.
 * Updates documentBlocks on project/tag without creating a sync operation.
 * The persistent sync is debounced separately (30s) via DocumentModeService.
 */
export const updateDocumentBlocksLocal = createAction(
  '[DocumentMode] Update Document Blocks Local',
  props<{
    contextId: string;
    contextType: 'PROJECT' | 'TAG';
    documentBlocks: DocumentBlock[];
  }>(),
);

/**
 * Persistent action that sends only the delta (changed/removed blocks + order).
 * Dispatched after debounce to create a sync operation with minimal payload.
 */
export const updateDocumentBlocksDelta = createAction(
  '[DocumentMode] Update Document Blocks Delta',
  (payload: {
    contextId: string;
    contextType: 'PROJECT' | 'TAG';
    delta: DocumentBlocksDelta;
  }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: payload.contextType,
      entityId: payload.contextId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
