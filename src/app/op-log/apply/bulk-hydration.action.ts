import { createAction, props } from '@ngrx/store';
import { Operation } from '../core/operation.types';

/**
 * Action to bulk-apply operations in a single NgRx dispatch.
 *
 * Used for:
 * - Local hydration (replaying tail operations at startup)
 * - Remote sync (applying operations from other clients)
 *
 * This dramatically improves performance by applying 500+ operations in one
 * store update instead of 500 individual dispatches.
 *
 * Key benefits for remote sync:
 * - Effects don't see individual actions (they only see this bulk action type)
 * - No need for LOCAL_ACTIONS filtering - effects naturally don't trigger
 * - Single store update = better performance
 *
 * `localClientId` is the id of THIS device. The bulk meta-reducer uses it to
 * tell own-op replay (clientId === localClientId) apart from genuinely remote
 * ops (another client) so that per-device "local-only" settings are preserved
 * only when a remote client's op would otherwise overwrite them — never when
 * replaying the device's own ops during hydration. See `bulkOperationsMetaReducer`
 * and `withLocalOnlySyncSettings`.
 */
export const bulkApplyOperations = createAction(
  '[OperationLog] Bulk Apply Operations',
  props<{ operations: Operation[]; localClientId?: string }>(),
);

/**
 * @deprecated Use bulkApplyOperations instead. Kept for backwards compatibility.
 */
export const bulkApplyHydrationOperations = bulkApplyOperations;
