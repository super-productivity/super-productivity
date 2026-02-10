import { inject, Injectable } from '@angular/core';
import { uuidv7 } from 'uuidv7';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { ClientIdService } from '../../core/util/client-id.service';
import {
  PreMigrationBackupService,
  PreMigrationReason,
} from './pre-migration-backup.service';
import { OpLog } from '../../core/log';
import { Operation, OpType } from '../core/operation.types';
import { ActionType } from '../core/action-types.enum';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import {
  incrementVectorClock,
  limitVectorClockSize,
  selectProtectedClientIds,
} from '../../core/util/vector-clock';

/**
 * Service for performing "clean slate" operations on the sync state.
 *
 * ## What is a Clean Slate?
 * A clean slate operation:
 * 1. Creates a pre-migration backup of current state (optional, placeholder for now)
 * 2. Generates a new client ID and fresh vector clock
 * 3. Creates a new SYNC_IMPORT operation with current state
 * 4. Clears all local operations (fresh start)
 * 5. Uploads the SYNC_IMPORT to server with `isCleanSlate=true` flag
 * 6. Server deletes ALL existing operations and accepts the new baseline
 *
 * ## When to Use
 * - **Encryption password changes**: New password requires fresh sync baseline
 * - **Full imports**: Importing a backup should reset sync history
 * - **Manual recovery**: User-initiated sync reset
 *
 * ## Benefits
 * - Prevents encrypted data from being mixed with unencrypted
 * - Avoids accumulation of old operations on server
 * - Provides clean recovery path for sync issues
 * - Simpler than defensive programming for edge cases
 *
 * @example
 * ```typescript
 * const cleanSlateService = inject(CleanSlateService);
 *
 * // Create clean slate for encryption change
 * await cleanSlateService.createCleanSlate('ENCRYPTION_CHANGE');
 *
 * // Now upload with the new encryption key
 * await syncService.triggerSync();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class CleanSlateService {
  private stateSnapshotService = inject(StateSnapshotService);
  private vectorClockService = inject(VectorClockService);
  private opLogStore = inject(OperationLogStoreService);
  private clientIdService = inject(ClientIdService);
  private preMigrationBackupService = inject(PreMigrationBackupService);

  /**
   * Creates a clean slate by resetting local operation log and preparing
   * a fresh SYNC_IMPORT operation for upload.
   *
   * ## Process
   * 1. Creates pre-migration backup (placeholder for now)
   * 2. Gets current application state
   * 3. Generates new client ID (fresh start)
   * 4. Creates fresh vector clock
   * 5. Creates SYNC_IMPORT operation
   * 6. Clears all local operations
   * 7. Stores the new SYNC_IMPORT locally
   * 8. Updates vector clock
   * 9. Saves new snapshot
   *
   * ## Important Notes
   * - This method does NOT upload to server - that happens in the next sync
   * - The SYNC_IMPORT operation will be uploaded with `isCleanSlate=true` flag
   * - Server will delete all operations when receiving the upload
   * - Other clients will detect the clean slate and re-sync from new baseline
   *
   * @param reason - Why the clean slate is being created
   * @throws If state snapshot cannot be retrieved or operations cannot be stored
   */
  async createCleanSlate(reason: PreMigrationReason): Promise<void> {
    OpLog.normal('[CleanSlate] Starting clean slate process', { reason });

    // 1. Create pre-migration backup (placeholder for now)
    try {
      await this.preMigrationBackupService.createPreMigrationBackup(reason);
    } catch (e) {
      OpLog.warn('[CleanSlate] Failed to create pre-migration backup', e);
      // Continue anyway - backup is optional safety feature
    }

    // 2. Get current application state (includes all features + archives)
    // IMPORTANT: Must use async version to load real archives from IndexedDB
    // The sync getStateSnapshot() returns DEFAULT_ARCHIVE (empty) which causes data loss
    const currentState = await this.stateSnapshotService.getStateSnapshotAsync();

    // 3. Generate new client ID (fresh start - all devices get new IDs after clean slate)
    const newClientId = await this.clientIdService.generateNewClientId();
    OpLog.normal('[CleanSlate] Generated new client ID', { newClientId });

    // 4. Create fresh vector clock starting at 1 for the new client
    const newVectorClock = { [newClientId]: 1 };

    // 5. Create SYNC_IMPORT operation
    // This will be uploaded to server with isCleanSlate=true flag
    const syncImportOp: Operation = {
      id: uuidv7(),
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.SyncImport, // Maps to reason='initial' on server
      entityType: 'ALL',
      entityId: undefined,
      payload: currentState,
      clientId: newClientId,
      vectorClock: newVectorClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    OpLog.normal('[CleanSlate] Created SYNC_IMPORT operation', {
      opId: syncImportOp.id,
      clientId: newClientId,
    });

    // 6. Clear all local operations (fresh start)
    OpLog.normal('[CleanSlate] Clearing all local operations');
    await this.opLogStore.clearAllOperations();

    // 7. Store the new SYNC_IMPORT locally (not synced yet)
    await this.opLogStore.append(syncImportOp);
    OpLog.normal('[CleanSlate] Stored SYNC_IMPORT operation locally');

    // 8. Update vector clock in dedicated store
    await this.opLogStore.setVectorClock(newVectorClock);
    OpLog.normal('[CleanSlate] Updated vector clock', { vectorClock: newVectorClock });

    // 9. Save new snapshot with the clean state
    await this.opLogStore.saveStateCache({
      state: currentState,
      lastAppliedOpSeq: 0, // Fresh start - no ops applied yet
      vectorClock: newVectorClock,
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    OpLog.normal('[CleanSlate] Saved new snapshot');

    OpLog.normal('[CleanSlate] Clean slate completed successfully', {
      syncImportId: syncImportOp.id,
      newClientId,
      reason,
    });
  }

  /**
   * Creates a clean slate using imported state instead of current state.
   *
   * This is used when importing a backup file - the imported state becomes
   * the new baseline for sync.
   *
   * @param importedState - The state to use as the new baseline
   * @param reason - Why the clean slate is being created (typically 'FULL_IMPORT')
   */
  async createCleanSlateFromImport(
    importedState: unknown,
    reason: PreMigrationReason,
  ): Promise<void> {
    OpLog.normal('[CleanSlate] Starting clean slate from import', { reason });

    // 1. Create pre-migration backup (placeholder for now)
    try {
      await this.preMigrationBackupService.createPreMigrationBackup(reason);
    } catch (e) {
      OpLog.warn('[CleanSlate] Failed to create pre-migration backup', e);
    }

    // 2. Generate new client ID
    const newClientId = await this.clientIdService.generateNewClientId();

    // 3. Get current vector clock and increment (we're adding a new operation)
    const currentClock = await this.vectorClockService.getCurrentVectorClock();
    // Prune to MAX_VECTOR_CLOCK_SIZE to match server-side pruning.
    // Without this, the local SYNC_IMPORT retains an oversized clock while the server
    // stores a pruned version, causing remote clients' ops to appear CONCURRENT.
    const newClock = limitVectorClockSize(
      incrementVectorClock(currentClock, newClientId),
      newClientId,
      [],
    );

    // 4. Create SYNC_IMPORT operation with imported state
    const syncImportOp: Operation = {
      id: uuidv7(),
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.SyncImport,
      entityType: 'ALL',
      entityId: undefined,
      payload: importedState,
      clientId: newClientId,
      vectorClock: newClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    // 5. Clear all local operations
    await this.opLogStore.clearAllOperations();

    // 6. Store the SYNC_IMPORT
    await this.opLogStore.append(syncImportOp);

    // 7. Update vector clock
    await this.opLogStore.setVectorClock(newClock);

    // 7b. CRITICAL: Set protected client IDs to include ALL vector clock keys from the SYNC_IMPORT.
    // This ensures all client IDs from the import aren't pruned from future vector clocks.
    // Without this, when new ops are created, limitVectorClockSize() would prune low-counter
    // entries, causing those ops to appear CONCURRENT with the import instead of GREATER_THAN.
    // See ServerMigrationService.handleServerMigration for detailed explanation.
    const protectedIds = selectProtectedClientIds(newClock);
    await this.opLogStore.setProtectedClientIds(protectedIds);
    OpLog.normal(
      `[CleanSlate] Set protected client IDs from SYNC_IMPORT: [${protectedIds.join(', ')}]`,
    );

    // 8. Save snapshot
    await this.opLogStore.saveStateCache({
      state: importedState,
      lastAppliedOpSeq: 0,
      vectorClock: newClock,
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    OpLog.normal('[CleanSlate] Clean slate from import completed', {
      syncImportId: syncImportOp.id,
      newClientId,
    });
  }
}
