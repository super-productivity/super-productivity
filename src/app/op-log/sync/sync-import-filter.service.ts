import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { Operation, OpType } from '../core/operation.types';
import {
  compareVectorClocks,
  VectorClockComparison,
  vectorClockToString,
} from '../../core/util/vector-clock';
import { MAX_VECTOR_CLOCK_SIZE } from '../core/operation-log.const';
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
   * | CONCURRENT     | See below                            | Depends |
   *
   * CONCURRENT ops from **unknown clients** (import clock has no entry for the
   * op's clientId) are KEPT when the import clock hasn't been pruned
   * (size < MAX_VECTOR_CLOCK_SIZE). These represent independent timelines
   * the import never intended to supersede. All other CONCURRENT ops are filtered.
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

    // Determine if the filtering import was created locally (by this client).
    // This is used to decide whether to show the conflict dialog.
    //
    // isLocalUnsyncedImport is TRUE only when:
    // 1. We're using the stored entry (not a batch import)
    // 2. The stored entry was created locally (source='local')
    // 3. The import has NOT been synced yet (!syncedAt)
    //
    // Once a local import has been synced to the server (syncedAt is set),
    // the import is established as the new baseline. Old remote ops that are
    // CONCURRENT with it are just stragglers that should be silently discarded
    // — the user already made their choice when they created the import, and
    // the server already has it. Showing the dialog again would cause an
    // infinite loop since the dialog returns before lastServerSeq is persisted.
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

    const importClockForComparison = latestImport.vectorClock;

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
      // - CONCURRENT + unknown client (not in import clock, clock not pruned) → KEEP
      // - CONCURRENT (all other cases) → FILTER
      // - LESS_THAN: Op is dominated by import → FILTER
      const comparison = compareVectorClocks(op.vectorClock, importClockForComparison);

      // DIAGNOSTIC LOGGING: Log vector clock comparison details
      // This helps debug issues where ops are incorrectly filtered as CONCURRENT
      OpLog.debug(
        `SyncImportFilterService: Comparing op ${op.id} (${op.actionType}) from client ${op.clientId}\n` +
          `  Op vectorClock:     ${vectorClockToString(op.vectorClock)}\n` +
          `  Import vectorClock: ${vectorClockToString(importClockForComparison)}` +
          `\n  Comparison result:  ${comparison}`,
      );

      if (
        comparison === VectorClockComparison.GREATER_THAN ||
        comparison === VectorClockComparison.EQUAL
      ) {
        // Op was created by a client that had knowledge of the import
        validOps.push(op);
      } else if (
        comparison === VectorClockComparison.CONCURRENT &&
        op.clientId === latestImport.clientId &&
        (op.vectorClock[op.clientId] ?? 0) > (importClockForComparison[op.clientId] ?? 0)
      ) {
        // Op is from the SAME client that created the import, with a higher counter.
        // A client can't create ops concurrent with its own import — all post-import
        // ops from the import client necessarily have causal knowledge of the import.
        // Same-client counter comparison is definitive (monotonically increasing),
        // not heuristic. CONCURRENT here is always a pruning artifact from asymmetric
        // clock evolution (different entries pruned from op's evolving clock vs
        // import's frozen clock).
        OpLog.normal(
          `SyncImportFilterService: KEEPING op ${op.id} (${op.actionType}) despite CONCURRENT - same client as import.\n` +
            `  Client ${op.clientId} counter: op=${op.vectorClock[op.clientId]} > import=${importClockForComparison[op.clientId]} (post-import op).`,
        );
        validOps.push(op);
      } else if (
        comparison === VectorClockComparison.CONCURRENT &&
        op.clientId !== latestImport.clientId &&
        (op.vectorClock[latestImport.clientId] ?? 0) >=
          (importClockForComparison[latestImport.clientId] ?? 0) &&
        (importClockForComparison[latestImport.clientId] ?? 0) > 0
      ) {
        // Op was created by a DIFFERENT client with knowledge of the import.
        // The SYNC_IMPORT incremented the importing client's counter, so any op whose
        // clock includes that counter value (or higher) must have received the import
        // (directly or transitively). CONCURRENT here is a clock-reset artifact: after
        // receiving a SYNC_IMPORT, clients reset their working clock to minimal (only
        // the import client's entry + own entry), so post-import ops lack entries for
        // old/dead client IDs that are still in the import's stored clock.
        //
        // ASSUMPTION: This relies on the SYNC_IMPORT op persisting in the op log for
        // filtering. Transitive propagation (client C learns import counter from client B
        // without directly receiving the import) is safe because the filter only runs
        // against ops that coexist with the SYNC_IMPORT in the log.
        //
        // NOTE: Ops from the import client itself are handled by the same-client check
        // above (which requires strictly greater counter, not equal).
        OpLog.normal(
          `SyncImportFilterService: KEEPING op ${op.id} (${op.actionType}) despite CONCURRENT ` +
            `- op has import client ${latestImport.clientId} counter ` +
            `${op.vectorClock[latestImport.clientId]} >= import counter ` +
            `${importClockForComparison[latestImport.clientId]} (post-import via clock reset).`,
        );
        validOps.push(op);
      } else if (
        comparison === VectorClockComparison.CONCURRENT &&
        importClockForComparison[op.clientId] === undefined &&
        Object.keys(importClockForComparison).length < MAX_VECTOR_CLOCK_SIZE
      ) {
        // Import has NO knowledge of this client — independent timelines that never
        // communicated. The import was created in complete ignorance of this client.
        // Filtering would silently discard data the import never intended to supersede.
        //
        // Safety: only apply when clock hasn't been pruned (size < MAX_VECTOR_CLOCK_SIZE).
        // If pruning occurred, a missing entry might be a pruned one, not truly unknown.
        OpLog.normal(
          `SyncImportFilterService: KEEPING op ${op.id} (${op.actionType}) despite CONCURRENT ` +
            `- import has no knowledge of client ${op.clientId} (independent timeline).`,
        );
        validOps.push(op);
      } else {
        // CONCURRENT or LESS_THAN: Op was created without knowledge of import
        // Filter it to ensure clean slate semantics
        OpLog.warn(
          `SyncImportFilterService: FILTERING op ${op.id} (${op.actionType}) as ${comparison}\n` +
            `  Op vectorClock:     ${vectorClockToString(op.vectorClock)}\n` +
            `  Import vectorClock: ${vectorClockToString(importClockForComparison)}` +
            `\n  Import client:      ${latestImport.clientId}\n` +
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
