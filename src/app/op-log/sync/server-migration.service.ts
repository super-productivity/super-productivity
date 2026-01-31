import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { incrementVectorClock, mergeVectorClocks } from '../../core/util/vector-clock';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { ActionType, Operation, OpType } from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';
import { OpLog } from '../../core/log';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';

/**
 * Service responsible for handling server migration scenarios.
 *
 * ## What is Server Migration?
 * Server migration occurs when a client with existing synced data connects to
 * a new/empty sync server. This can happen when:
 * 1. User switches to a new sync provider
 * 2. Sync server is reset/cleared
 * 3. User restores from a backup on a fresh server
 *
 * ## Why is it needed?
 * Without server migration handling, incremental operations uploaded to the new
 * server would reference entities (tasks, projects, tags) that don't exist on
 * the server, causing sync failures for other clients.
 *
 * ## The Solution
 * When migration is detected, this service creates a SYNC_IMPORT operation
 * containing the full current state. This ensures all entities exist on the
 * server before incremental operations are applied.
 */
@Injectable({
  providedIn: 'root',
})
export class ServerMigrationService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private vectorClockService = inject(VectorClockService);
  private validateStateService = inject(ValidateStateService);
  private stateSnapshotService = inject(StateSnapshotService);
  private snackService = inject(SnackService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);

  /**
   * Checks if we're connecting to a new/empty server and handles migration if needed.
   *
   * ## Detection Logic
   * Server migration is detected when ALL of these conditions are true:
   * 1. This is a sync-capable provider (supports operation-based sync)
   * 2. lastServerSeq is 0 (first time connecting to this server)
   * 3. Server is empty (no operations to download)
   * 4. Client has PREVIOUSLY synced operations (not a fresh client)
   *
   * ## Why "previously synced" matters
   * A fresh client with only local (unsynced) ops is NOT a migration scenario.
   * Fresh clients should just upload their ops normally without creating a SYNC_IMPORT.
   *
   * @param syncProvider - The sync provider to check against
   */
  async checkAndHandleMigration(syncProvider: OperationSyncCapable): Promise<void> {
    // Check if lastServerSeq is 0 (first time connecting to this server)
    const lastServerSeq = await syncProvider.getLastServerSeq();
    if (lastServerSeq !== 0) {
      // We've synced with this server before, no migration needed
      return;
    }

    // Check if server is empty by doing a minimal download request
    const response = await syncProvider.downloadOps(0, undefined, 1);
    if (response.latestSeq !== 0) {
      // Server has data, this is not a migration scenario
      // (might be joining an existing sync group)
      return;
    }

    // CRITICAL: Check if this client has PREVIOUSLY synced operations.
    // A client that has never synced (only local ops) is NOT a migration case.
    // It's just a fresh client that should upload its ops normally.
    const hasSyncedOps = await this.opLogStore.hasSyncedOps();
    if (!hasSyncedOps) {
      OpLog.normal(
        'ServerMigrationService: Empty server detected, but no previously synced ops. ' +
          'This is a fresh client, not a server migration. Proceeding with normal upload.',
      );
      return;
    }

    // Server is empty AND we have PREVIOUSLY SYNCED ops AND lastServerSeq is 0
    // This is a server migration - create SYNC_IMPORT with full state
    OpLog.warn(
      'ServerMigrationService: Server migration detected during upload check. ' +
        'Empty server with previously synced ops. Creating full state SYNC_IMPORT.',
    );
    await this.handleServerMigration(syncProvider);
  }

  /**
   * Handles server migration by creating a SYNC_IMPORT operation with full current state.
   *
   * ## Process
   * 1. Double-check server is still empty (in case another client just uploaded)
   *    - Unless skipServerEmptyCheck is true (for force upload scenarios)
   * 2. Get current state from NgRx store
   * 3. Skip if state is empty (nothing to migrate)
   * 4. Validate and repair state (prevent propagating corruption)
   * 5. Create SYNC_IMPORT operation with full state (with merged vector clocks)
   * 6. Append to operation log for upload
   *
   * ## State Validation
   * Before creating SYNC_IMPORT, the state is validated and repaired if needed.
   * This prevents corrupted state (e.g., orphaned references) from propagating
   * to other clients via the full state import.
   *
   * ## Vector Clock Merging
   * The SYNC_IMPORT's vector clock must dominate ALL existing local operations.
   * We merge all local op clocks to ensure that when SyncImportFilterService
   * compares operations, all pre-import ops are LESS_THAN the import.
   *
   * @param syncProvider - The sync provider to use for double-check
   * @param options - Optional configuration
   * @param options.skipServerEmptyCheck - If true, creates SYNC_IMPORT even if server has data.
   *   Used for "USE_LOCAL" conflict resolution to force overwrite remote with local state.
   */
  async handleServerMigration(
    syncProvider: OperationSyncCapable,
    options?: { skipServerEmptyCheck?: boolean },
  ): Promise<void> {
    // Double-check server is still empty (in case another client just uploaded)
    // This is called inside the upload lock, but network timing could still race
    // Skip this check when forcing upload (conflict resolution "USE_LOCAL")
    if (!options?.skipServerEmptyCheck) {
      const freshCheck = await syncProvider.downloadOps(0, undefined, 1);
      if (freshCheck.latestSeq !== 0) {
        OpLog.warn(
          'ServerMigrationService: Server no longer empty, aborting SYNC_IMPORT. ' +
            'Another client may have just uploaded.',
        );
        return;
      }
    }

    OpLog.warn(
      'ServerMigrationService: Server migration detected. Creating full state SYNC_IMPORT.',
    );

    // Get current full state from NgRx store (async to include archives from IndexedDB)
    // Cast to Record for validation compatibility
    let currentState: Record<string, unknown> =
      (await this.stateSnapshotService.getStateSnapshotAsync()) as unknown as Record<
        string,
        unknown
      >;

    // Skip if local state is effectively empty
    if (this._isEmptyState(currentState)) {
      OpLog.warn('ServerMigrationService: Skipping SYNC_IMPORT - local state is empty.');
      return;
    }

    // Validate and repair state before creating SYNC_IMPORT
    // This prevents corrupted state (e.g., orphaned menuTree references) from
    // propagating to other clients via the full state import.
    const validationResult = this.validateStateService.validateAndRepair(currentState);

    // If state is invalid and couldn't be repaired, abort - don't propagate corruption
    if (!validationResult.isValid) {
      OpLog.err(
        'ServerMigrationService: Cannot create SYNC_IMPORT - state validation failed.',
        validationResult.error || validationResult.crossModelError,
      );
      this.snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.SERVER_MIGRATION_VALIDATION_FAILED,
      });
      return;
    }

    // If state was repaired, use the repaired version
    if (validationResult.repairedState) {
      OpLog.warn(
        'ServerMigrationService: State repaired before creating SYNC_IMPORT',
        validationResult.repairSummary,
      );
      currentState = validationResult.repairedState;

      // Also update NgRx store with repaired state so local client is consistent
      this.store.dispatch(
        loadAllData({ appDataComplete: validationResult.repairedState as any }),
      );
    }

    // Get client ID
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ServerMigrationService: Cannot create SYNC_IMPORT - no client ID available.',
      );
      return;
    }

    // Build vector clock by merging ALL local operation clocks.
    // This ensures the SYNC_IMPORT's clock dominates all pre-import ops,
    // so when SyncImportFilterService compares them, all prior ops are
    // LESS_THAN (not CONCURRENT) and can be properly filtered.
    const allLocalOps = await this.opLogStore.getOpsAfterSeq(0);
    let mergedClock = await this.vectorClockService.getCurrentVectorClock();
    for (const entry of allLocalOps) {
      mergedClock = mergeVectorClocks(mergedClock, entry.op.vectorClock);
    }
    const newClock = incrementVectorClock(mergedClock, clientId);

    OpLog.normal(
      `ServerMigrationService: Merged ${allLocalOps.length} local op clocks into SYNC_IMPORT vector clock.`,
    );

    // Create SYNC_IMPORT operation with full state
    // NOTE: Use raw state directly (not wrapped in appDataComplete).
    // The snapshot endpoint expects raw state, and the hydrator handles
    // both formats on extraction.
    const op: Operation = {
      id: uuidv7(),
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.SyncImport,
      entityType: 'ALL',
      payload: currentState,
      clientId,
      vectorClock: newClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    // Append to operation log - will be uploaded via snapshot endpoint
    await this.opLogStore.append(op, 'local');

    // CRITICAL: Set protected client IDs to include ALL vector clock keys from the SYNC_IMPORT.
    // When new operations are created after this SYNC_IMPORT, limitVectorClockSize() is called
    // which prunes low-counter entries. Without protecting all these IDs, subsequent ops
    // would have incomplete clocks (missing the pruned entries), causing them to appear
    // CONCURRENT with this SYNC_IMPORT instead of GREATER_THAN. This leads to the bug where
    // other clients filter out legitimate ops as "invalidated by SYNC_IMPORT".
    const protectedIds = Object.keys(newClock);
    await this.opLogStore.setProtectedClientIds(protectedIds);
    OpLog.normal(
      `ServerMigrationService: Set protected client IDs from SYNC_IMPORT: [${protectedIds.join(', ')}]`,
    );

    OpLog.normal(
      'ServerMigrationService: Created SYNC_IMPORT operation for server migration. ' +
        'Will be uploaded immediately via follow-up upload.',
    );
  }

  /**
   * Checks if the state is effectively empty (no meaningful data to sync).
   * An empty state has no tasks, projects, or user-created tags.
   */
  private _isEmptyState(state: unknown): boolean {
    if (!state || typeof state !== 'object') {
      return true;
    }

    const s = state as Record<string, unknown>;

    // Check for meaningful data in key entity collections
    const taskState = s['task'] as { ids?: unknown[] } | undefined;
    const projectState = s['project'] as { ids?: unknown[] } | undefined;
    const tagState = s['tag'] as { ids?: (string | unknown)[] } | undefined;

    const hasNoTasks = !taskState?.ids || taskState.ids.length === 0;
    const hasNoProjects = !projectState?.ids || projectState.ids.length === 0;
    const hasNoUserTags = this._hasNoUserCreatedTags(tagState?.ids);

    // Consider empty if there are no tasks, projects, or user-defined tags
    return hasNoTasks && hasNoProjects && hasNoUserTags;
  }

  /**
   * Checks if there are no user-created tags.
   * System tags (TODAY, URGENT, IMPORTANT, IN_PROGRESS) are excluded from the count.
   */
  private _hasNoUserCreatedTags(tagIds: (string | unknown)[] | undefined): boolean {
    if (!tagIds || tagIds.length === 0) {
      return true;
    }
    const userTagCount = tagIds.filter(
      (id) => typeof id === 'string' && !SYSTEM_TAG_IDS.has(id),
    ).length;
    return userTagCount === 0;
  }
}
