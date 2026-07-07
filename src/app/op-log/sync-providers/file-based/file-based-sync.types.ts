import {
  FILE_BASED_SYNC_CONSTANTS,
  type FileBasedSyncData as GenericFileBasedSyncData,
  type SyncFileCompactOp as GenericSyncFileCompactOp,
  type FileBasedOpsFile as GenericFileBasedOpsFile,
  type FileBasedStateFile as GenericFileBasedStateFile,
  type FileBasedSnapshotRef,
  type FileBasedSplitTombstone,
} from '@sp/sync-providers/file-based';
import type { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';
import { CompactOperation } from '../../persistence/compact/compact-operation.types';

export { FILE_BASED_SYNC_CONSTANTS };
export type { FileBasedSnapshotRef, FileBasedSplitTombstone };

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

/**
 * SPAP-11: app-specific binding for the split-format ops file (`sync-ops.json`).
 */
export type FileBasedOpsFile = GenericFileBasedOpsFile<CompactOperation>;

/**
 * SPAP-11: app-specific binding for the split-format snapshot file
 * (`sync-state.json`).
 */
export type FileBasedStateFile = GenericFileBasedStateFile<unknown, ArchiveModel>;
