import type { ApplyOperationsOptions, ApplyOperationsResult } from './apply.types';
import type { Operation, OperationLogEntry } from './operation.types';

export type SyncPortMeta = Record<string, string | number | boolean | null | undefined>;

/**
 * Minimal action shape used at sync-core boundaries.
 *
 * Hosts keep their framework-specific action types app-side. The core only
 * requires an opaque action type string and preserves any host metadata.
 */
export interface SyncActionLike {
  type: string;
  meta?: unknown;
}

/**
 * Port for applying operation batches to host state.
 */
export interface OperationApplyPort<TOperation extends Operation<string> = Operation> {
  applyOperations(
    ops: TOperation[],
    options?: ApplyOperationsOptions,
  ): Promise<ApplyOperationsResult<TOperation>>;
}

/**
 * Port for dispatching host actions.
 *
 * Implementations must preserve action objects, especially host `meta`, exactly.
 */
export interface ActionDispatchPort<TAction extends SyncActionLike = SyncActionLike> {
  dispatch(action: TAction): void;
}

/**
 * Port for suppressing local side effects while remote operations replay.
 */
export interface RemoteApplyWindowPort {
  startApplyingRemoteOps(): void;
  endApplyingRemoteOps(): void;
  startPostSyncCooldown(durationMs?: number): void;
  isApplyingRemoteOps?(): boolean;
}

/**
 * Port for flushing local user actions that were deferred during remote replay.
 */
export interface DeferredLocalActionsPort {
  processDeferredActions(): Promise<void> | void;
}

/**
 * Port for host-owned side effects that must run after remote action replay.
 */
export interface ArchiveSideEffectPort<TAction extends SyncActionLike = SyncActionLike> {
  handleOperation(action: TAction): Promise<void> | void;
}

/**
 * Port for operation-log persistence.
 *
 * This is intentionally small until orchestration code is moved. Add methods as
 * specific core coordinators need them rather than mirroring an app database
 * service wholesale.
 */
export interface OperationStorePort<
  TOperation extends Operation<string> = Operation,
  TEntry extends OperationLogEntry<TOperation> = OperationLogEntry<TOperation>,
> {
  getUnsynced(): Promise<TEntry[]>;
  markSynced(seqs: number[]): Promise<void>;
  markRejected(opIds: string[]): Promise<void>;
}

/**
 * Domain-free sync configuration snapshot.
 *
 * Provider IDs stay plain strings at the package boundary. Host applications can
 * narrow them in their adapter layer.
 */
export interface SyncConfigSnapshot<TProviderId extends string = string> {
  isEnabled: boolean;
  syncProvider: TProviderId | null;
  isEncryptionEnabled?: boolean;
  isCompressionEnabled?: boolean;
  isManualSyncOnly?: boolean;
  syncInterval?: number;
}

/**
 * Port for reading host sync configuration without importing framework store
 * selectors or host provider enums.
 */
export interface SyncConfigPort<TProviderId extends string = string> {
  getSyncConfig(): Promise<SyncConfigSnapshot<TProviderId>>;
}

export interface ConflictUiDialogRequest {
  conflictType: string;
  scenario?: string;
  reason?: string;
  counts?: Record<string, number>;
  timestamps?: Record<string, number>;
  meta?: SyncPortMeta;
}

export type ConflictUiNotificationSeverity = 'info' | 'warning' | 'error';

export interface ConflictUiNotification {
  severity: ConflictUiNotificationSeverity;
  message: string;
  reason?: string;
  meta?: SyncPortMeta;
}

/**
 * Port for conflict dialogs/snacks. Resolutions are strings so the host owns
 * user-facing choices such as USE_LOCAL, USE_REMOTE, or CANCEL.
 */
export interface ConflictUiPort<TResolution extends string = string> {
  showConflictDialog(request: ConflictUiDialogRequest): Promise<TResolution>;
  notify?(notification: ConflictUiNotification): Promise<void> | void;
}
