import { AppStateSnapshot } from '../../core/types/backup.types';
import type { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import type { StateSnapshotService } from '../../backup/state-snapshot.service';

/** Internal upload argument; never persisted or sent as part of the wire format. */
export interface CapturedFileState {
  kind: 'capturedFileState';
  state: Omit<AppStateSnapshot, 'archiveYoung' | 'archiveOld'>;
  archiveYoung: AppStateSnapshot['archiveYoung'];
  archiveOld: AppStateSnapshot['archiveOld'];
  taskArchiveSnapshotVersion?: 1;
}

export const captureFileState = (
  snapshot: AppStateSnapshot,
  taskDataUnmodified = false,
): CapturedFileState => {
  const { archiveYoung, archiveOld, ...state } = snapshot;
  return {
    kind: 'capturedFileState',
    state,
    archiveYoung,
    archiveOld,
    ...(taskDataUnmodified ? { taskArchiveSnapshotVersion: 1 as const } : {}),
  };
};

/** Raw full-state payloads remain valid for the existing snapshot-upload paths. */
const getCapturedFileState = (value: unknown): CapturedFileState | undefined =>
  value !== null &&
  typeof value === 'object' &&
  'kind' in value &&
  value.kind === 'capturedFileState'
    ? (value as CapturedFileState)
    : undefined;

export const resolveFileState = async (
  value: unknown,
  snapshots: Pick<StateSnapshotService, 'getStateSnapshotForOperationLog'>,
  archives: Pick<ArchiveDbAdapter, 'loadArchiveYoung' | 'loadArchiveOld'>,
): Promise<{
  state: unknown;
  archiveYoung: AppStateSnapshot['archiveYoung'] | undefined;
  archiveOld: AppStateSnapshot['archiveOld'] | undefined;
  taskArchiveSnapshotVersion?: 1;
}> => {
  const captured = getCapturedFileState(value);
  if (captured) return captured;
  // Preserve the existing raw full-state / direct adapter call semantics.
  const state = value ?? snapshots.getStateSnapshotForOperationLog();
  const archiveYoung = await archives.loadArchiveYoung();
  const archiveOld = await archives.loadArchiveOld();
  return { state, archiveYoung, archiveOld };
};
