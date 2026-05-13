import {
  FILE_BASED_SYNC_CONSTANTS,
  type FileBasedSyncData as GenericFileBasedSyncData,
  type SyncFileCompactOp as GenericSyncFileCompactOp,
} from '@sp/sync-providers/file-based';
import type { CompactOperation } from '../../../core/persistence/operation-log/compact/compact-operation.types';
import type { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';

export { FILE_BASED_SYNC_CONSTANTS };

/**
 * App-specific compact op wrapper stored in the file-based sync envelope.
 */
export type SyncFileCompactOp = GenericSyncFileCompactOp<CompactOperation>;

/**
 * App-specific binding for the generic file-based sync envelope.
 */
export type FileBasedSyncData = GenericFileBasedSyncData<
  unknown,
  CompactOperation,
  ArchiveModel
>;
