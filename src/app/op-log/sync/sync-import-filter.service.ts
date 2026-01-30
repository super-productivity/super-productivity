import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { Operation, OpType } from '../core/operation.types';
import {
  compareVectorClocks,
  VectorClockComparison,
  vectorClockToString,
} from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';

/**
 * Service responsible for filtering operations invalidated by SYNC_IMPORT, BACKUP_IMPORT, or REPAIR operations.
 *
 * ## The Problem
 * ```
 * Timeline:
 *   Client A creates ops → Client B does SYNC_IMPORT → Client A syncs
 *
 * Result:
 *   - Client A's ops have higher serverSeq than SYNC_IMPORT
 *   - But they reference entities that were WIPED by the import
 *   - Applying them causes "Task not found" errors
 * ```
 *
 * ## The Solution: Clean Slate Semantics
 * SYNC_IMPORT and BACKUP_IMPORT are explicit user actions to restore ALL clients
 * to a specific state. ALL operations without knowledge of the import are dropped:
 *
 * - **GREATER_THAN / EQUAL**: Op was created with knowledge of import → KEEP
 * - **CONCURRENT**: Op was created without knowledge of import → DROP
 * - **LESS_THAN**: Op is dominated by import → DROP
 *
 * This ensures a true "restore to point in time" semantic. Concurrent work from
 * other clients is intentionally discarded because the user explicitly chose to
 * reset all state to the imported snapshot.
 *
 * We use vector clock comparison (not UUIDv7 timestamps) because vector clocks
 * track CAUSALITY (did the client know about the import?) rather than wall-clock
 * time (which can be affected by clock drift).
 */
@Injectable({
  providedIn: 'root',
})
export class SyncImportFilterService {
  private opLogStore = inject(OperationLogStoreService);

  /**
   * Filters out operations invalidated by a SYNC_IMPORT, BACKUP_IMPORT, or REPAIR.
   *
   * ## Clean Slate Semantics
   * Imports are explicit user actions to restore all clients to a specific state.
   * ALL operations without knowledge of the import are dropped - no exceptions.
   *
   * ## Vector Clock Comparison Results
   * | Comparison     | Meaning                              | Action  |
   * |----------------|--------------------------------------|---------|
   * | GREATER_THAN   | Op created after seeing import       | ✅ Keep |
   * | EQUAL          | Same causal history as import        | ✅ Keep |
   * | LESS_THAN      | Op dominated by import               | ❌ Filter|
   * | CONCURRENT     | Op created without knowledge of import| ❌ Filter|
   *
   * CONCURRENT ops are filtered even if they come from a client the import
   * didn't know about. This ensures a true "restore to point in time" semantic.
   *
   * The import can be in the current batch OR in the local store from a
   * previous sync cycle. We check both to handle the case where old ops from
   * another client arrive after we already downloaded the import.
   *
   * @param ops - Operations to filter (already migrated)
   * @returns Object with `validOps`, `invalidatedOps`, optionally `filteringImport`,
   *          and `isLocalUnsyncedImport` indicating if dialog should be shown
   */
  async filterOpsInvalidatedBySyncImport(ops: Operation[]): Promise<{
    validOps: Operation[];
    invalidatedOps: Operation[];
    filteringImport?: Operation;
    isLocalUnsyncedImport: boolean;
  }> {
    // Find full state import operations (SYNC_IMPORT, BACKUP_IMPORT, or REPAIR) in current batch
    const fullStateImportsInBatch = ops.filter(
      (op) =>
        op.opType === OpType.SyncImport ||
        op.opType === OpType.BackupImport ||
        op.opType === OpType.Repair,
    );

    // Check local store for previously downloaded import
    // Use getLatestFullStateOpEntry to get metadata (source, syncedAt)
    const storedEntry = await this.opLogStore.getLatestFullStateOpEntry();
    const storedImport = storedEntry?.op;

    // Determine the latest import (from batch or store)
    // Also track whether we're using the stored entry (needed for isLocalUnsyncedImport check)
    let latestImport: Operation | undefined;
    let usingStoredEntry = false;

    if (fullStateImportsInBatch.length > 0) {
      // Find the latest in the current batch
      const latestInBatch = fullStateImportsInBatch.reduce((latest, op) =>
        op.id > latest.id ? op : latest,
      );
      // Compare with stored import (if any)
      if (storedImport && storedImport.id > latestInBatch.id) {
        latestImport = storedImport;
        usingStoredEntry = true;
      } else {
        latestImport = latestInBatch;
        usingStoredEntry = false;
      }
    } else if (storedImport) {
      // No import in batch, but we have one from a previous sync
      latestImport = storedImport;
      usingStoredEntry = true;
    }

    // No imports found anywhere = no filtering needed
    if (!latestImport) {
      return { validOps: ops, invalidatedOps: [], isLocalUnsyncedImport: false };
    }

    // Determine if the filtering import is a local unsynced import.
    // This is used to decide whether to show the conflict dialog.
    //
    // isLocalUnsyncedImport is TRUE only when:
    // 1. We're using the stored entry (not a batch import)
    // 2. The stored entry was created locally (source='local')
    // 3. It hasn't been synced yet (no syncedAt)
    //
    // When true, the dialog SHOULD show - user must choose between their local
    // import and the remote data being filtered.
    //
    // When false (batch import, remote stored import, or synced local import),
    // the dialog should NOT show - old ops are silently discarded.
    const isLocalUnsyncedImport =
      usingStoredEntry &&
      !!storedEntry &&
      storedEntry.source === 'local' &&
      !storedEntry.syncedAt;

    OpLog.normal(
      `SyncImportFilterService: Filtering ops against SYNC_IMPORT from client ${latestImport.clientId} (op: ${latestImport.id})`,
    );
    OpLog.debug(
      `SyncImportFilterService: SYNC_IMPORT vectorClock: ${vectorClockToString(latestImport.vectorClock)}`,
    );

    const validOps: Operation[] = [];
    const invalidatedOps: Operation[] = [];

    for (const op of ops) {
      // Full state import operations themselves are always valid
      if (
        op.opType === OpType.SyncImport ||
        op.opType === OpType.BackupImport ||
        op.opType === OpType.Repair
      ) {
        validOps.push(op);
        continue;
      }

      // Use VECTOR CLOCK comparison instead of UUIDv7 timestamps.
      // Vector clocks track CAUSALITY ("did this client know about the import?")
      // rather than wall-clock time, making them immune to client clock drift.
      //
      // Clean Slate Semantics:
      // - GREATER_THAN: Op was created by a client that SAW the import → KEEP
      // - EQUAL: Same causal history as import → KEEP
      // - CONCURRENT: Op created WITHOUT knowledge of import → FILTER
      // - LESS_THAN: Op is dominated by import → FILTER
      //
      // CONCURRENT ops are filtered even from "unknown" clients. The import is
      // an explicit user action to restore to a specific state - any concurrent
      // work is intentionally discarded to ensure a clean slate.
      const comparison = compareVectorClocks(op.vectorClock, latestImport.vectorClock);

      // DIAGNOSTIC LOGGING: Log vector clock comparison details
      // This helps debug issues where ops are incorrectly filtered as CONCURRENT
      OpLog.debug(
        `SyncImportFilterService: Comparing op ${op.id} (${op.actionType}) from client ${op.clientId}\n` +
          `  Op vectorClock:     ${vectorClockToString(op.vectorClock)}\n` +
          `  Import vectorClock: ${vectorClockToString(latestImport.vectorClock)}\n` +
          `  Comparison result:  ${comparison}`,
      );

      if (
        comparison === VectorClockComparison.GREATER_THAN ||
        comparison === VectorClockComparison.EQUAL
      ) {
        // Op was created by a client that had knowledge of the import
        validOps.push(op);
      } else {
        // CONCURRENT or LESS_THAN: Op was created without knowledge of import
        // Filter it to ensure clean slate semantics
        OpLog.warn(
          `SyncImportFilterService: FILTERING op ${op.id} (${op.actionType}) as ${comparison}\n` +
            `  Op vectorClock:     ${vectorClockToString(op.vectorClock)}\n` +
            `  Import vectorClock: ${vectorClockToString(latestImport.vectorClock)}\n` +
            `  Import client:      ${latestImport.clientId}\n` +
            `  Op client:          ${op.clientId}`,
        );
        invalidatedOps.push(op);
      }
    }

    return {
      validOps,
      invalidatedOps,
      filteringImport: latestImport,
      isLocalUnsyncedImport,
    };
  }
}
