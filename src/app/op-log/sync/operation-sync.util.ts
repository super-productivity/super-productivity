import { ActionType, OpType, Operation } from '../core/operation.types';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  SyncOperation,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';

/** Provider IDs that use file-based operation sync (WebDAV, Dropbox, LocalFile) */
const FILE_BASED_PROVIDER_IDS: Set<SyncProviderId> = new Set([
  SyncProviderId.WebDAV,
  SyncProviderId.Dropbox,
  SyncProviderId.LocalFile,
]);

/**
 * Type guard to check if a provider supports operation-based sync (API sync).
 * This is for providers like SuperSync that have a dedicated API endpoint.
 */
export const isOperationSyncCapable = (
  provider: SyncProviderServiceInterface<SyncProviderId>,
): provider is SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable => {
  return (
    'supportsOperationSync' in provider &&
    (provider as unknown as OperationSyncCapable).supportsOperationSync === true
  );
};

/**
 * Type guard to check if a provider uses file-based operation sync.
 * File-based providers (WebDAV, Dropbox, LocalFile) use file storage for sync.
 */
export const isFileBasedProvider = (
  provider: SyncProviderServiceInterface<SyncProviderId>,
): boolean => {
  return FILE_BASED_PROVIDER_IDS.has(provider.id);
};

const VALID_OP_TYPES = new Set<string>(Object.values(OpType));

/**
 * Convert a SyncOperation (from API response) to an Operation (local format).
 */
export const syncOpToOperation = (syncOp: SyncOperation): Operation => {
  if (!VALID_OP_TYPES.has(syncOp.opType)) {
    throw new Error(`Invalid opType from server: '${syncOp.opType}'`);
  }

  return {
    id: syncOp.id,
    clientId: syncOp.clientId,
    actionType: syncOp.actionType as ActionType,
    opType: syncOp.opType as Operation['opType'],
    entityType: syncOp.entityType as Operation['entityType'],
    entityId: syncOp.entityId,
    entityIds: syncOp.entityIds,
    payload: syncOp.payload,
    vectorClock: syncOp.vectorClock,
    timestamp: syncOp.timestamp,
    schemaVersion: syncOp.schemaVersion,
  };
};
