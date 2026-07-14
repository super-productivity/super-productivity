import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { isFullStateOpType, Operation, OpType } from '../core/operation.types';
import { vectorClockToString } from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';
import { classifyOpAgainstSyncImport } from '@sp/sync-core';

/**
 * Service responsible for filtering operations invalidated by full-state operations.
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
 * ## The Solution: Import vs. Repair Semantics
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
 * REPAIR is automatic, so it is narrower: causally older operations are already
 * represented by its snapshot, while CONCURRENT operations replay on top. The
 * SuperSync server separately rejects a repair whose captured server cursor is
 * stale, ensuring an accepted repair cannot have an unknown concurrent prefix.
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
   * Filters out operations invalidated by a full-state operation.
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
   * | CONCURRENT     | Op lacks causal knowledge of import  | ❌ Filter|
   *
   * Some post-import ops can still compare as CONCURRENT after clock pruning or
   * post-import clock reset. Those are kept only when their own client counter
   * or the import client's counter proves causal knowledge of the import.
   *
   * The import can be in the current batch OR in the local store from a
   * previous sync cycle. We check both to handle the case where old ops from
   * another client arrive after we already downloaded the import.
   *
   * @param ops - Operations to filter (already migrated)
   * @returns Object with `validOps`, `invalidatedOps`, optionally `filteringImport`,
   *          and `isLocalUnsyncedImport` indicating if dialog should be shown
   */
  async filterOpsInvalidatedBySyncImport(
    ops: Operation[],
    options?: { ignoredLocalFullStateOpIds?: readonly string[] },
  ): Promise<{
    validOps: Operation[];
    invalidatedOps: Operation[];
    filteringImport?: Operation;
    isLocalUnsyncedImport: boolean;
  }> {
    // Find full state import operations (SYNC_IMPORT, BACKUP_IMPORT, or REPAIR) in current batch
    const fullStateImportsInBatch = ops.filter((op) => isFullStateOpType(op.opType));

    // Check local store for previously downloaded import
    // Use getLatestFullStateOpEntry to get metadata (source, syncedAt)
    const candidateStoredEntry = await this.opLogStore.getLatestFullStateOpEntry();
    const ignoredLocalFullStateOpIds = new Set(options?.ignoredLocalFullStateOpIds ?? []);
    const storedEntry =
      candidateStoredEntry?.source === 'local' &&
      ignoredLocalFullStateOpIds.has(candidateStoredEntry.op.id)
        ? undefined
        : candidateStoredEntry;
    const storedImport = storedEntry?.op;

    // Determine the latest import by durable apply order. Download batches are
    // ordered by server sequence, and every op in this batch is newer than the
    // already-applied local baseline. UUIDv7 IDs cannot provide this ordering:
    // they are generated from independent client wall clocks.
    // Also track whether we're using the stored entry (needed for isLocalUnsyncedImport check).
    let latestImport: Operation | undefined;
    let usingStoredEntry = false;

    if (fullStateImportsInBatch.length > 0) {
      latestImport = fullStateImportsInBatch[fullStateImportsInBatch.length - 1];
      usingStoredEntry = false;
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
    // 4. The boundary is an explicit import/restore, not automatic REPAIR
    //
    // Automatic REPAIR never opens the explicit import/restore conflict dialog;
    // its concurrent work is replayed on top instead. Once a local import has
    // been synced to the server (syncedAt is set),
    // the import is established as the new baseline. Old remote ops that are
    // CONCURRENT with it are just stragglers that should be silently discarded
    // — the user already made their choice when they created the import, and
    // the server already has it. Showing the dialog again would cause an
    // infinite loop since the dialog returns before lastServerSeq is persisted.
    const isLocalUnsyncedImport =
      usingStoredEntry &&
      !!storedEntry &&
      storedEntry.source === 'local' &&
      !storedEntry.syncedAt &&
      latestImport.opType !== OpType.Repair;

    OpLog.normal(
      `SyncImportFilterService: Filtering ops against SYNC_IMPORT from client ${latestImport.clientId} (op: ${latestImport.id})`,
    );
    OpLog.debug(
      `SyncImportFilterService: SYNC_IMPORT vectorClock: ${vectorClockToString(latestImport.vectorClock)}`,
    );

    const importClockForComparison = latestImport.vectorClock;
    const latestImportBatchIndex = usingStoredEntry ? -1 : ops.lastIndexOf(latestImport);

    const validOps: Operation[] = [];
    const invalidatedOps: Operation[] = [];
    const repairConcurrentPrefixOps: Operation[] = [];

    for (const [opIndex, op] of ops.entries()) {
      // Full state import operations themselves are always valid
      if (isFullStateOpType(op.opType)) {
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
      // - CONCURRENT + proven post-import counter knowledge → KEEP
      // - CONCURRENT (all other cases) → FILTER
      // - LESS_THAN: Op is dominated by import → FILTER
      const decision = classifyOpAgainstSyncImport(op, latestImport);

      // DIAGNOSTIC LOGGING: Log vector clock comparison details
      // This helps debug issues where ops are incorrectly filtered as CONCURRENT
      OpLog.debug(
        `SyncImportFilterService: Comparing op ${op.id} (${op.actionType}) from client ${op.clientId}\n` +
          `  Op vectorClock:     ${vectorClockToString(op.vectorClock)}\n` +
          `  Import vectorClock: ${vectorClockToString(importClockForComparison)}` +
          `\n  Comparison result:  ${decision.comparison}`,
      );

      if (decision.reason === 'greater-than' || decision.reason === 'equal') {
        // Op was created by a client that had knowledge of the import
        validOps.push(op);
      } else if (decision.reason === 'same-client-post-import') {
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
      } else if (decision.reason === 'knows-import-counter') {
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
        latestImport.opType === OpType.Repair &&
        decision.reason === 'concurrent'
      ) {
        const isPrefixOp =
          latestImportBatchIndex !== -1 && opIndex < latestImportBatchIndex;
        if (isPrefixOp && latestImport.repairBaseServerSeq !== undefined) {
          // A causal repair was built from the exact server prefix named by its
          // base cursor. Replaying a concurrent prefix op would apply it twice.
          invalidatedOps.push(op);
        } else if (isPrefixOp) {
          // A legacy repair has no proof that its snapshot covered the server
          // prefix. Move concurrent prefix work after the full-state boundary.
          repairConcurrentPrefixOps.push(op);
        } else {
          // Concurrent operations after the repair (or downloaded after a
          // previously stored repair) cannot be represented by its snapshot.
          validOps.push(op);
        }
      } else {
        // CONCURRENT or LESS_THAN: Op was created without knowledge of import
        // Filter it to ensure clean slate semantics
        OpLog.warn(
          `SyncImportFilterService: FILTERING op ${op.id} (${op.actionType}) as ${decision.comparison}\n` +
            `  Op vectorClock:     ${vectorClockToString(op.vectorClock)}\n` +
            `  Import vectorClock: ${vectorClockToString(importClockForComparison)}` +
            `\n  Import client:      ${latestImport.clientId}\n` +
            `  Op client:          ${op.clientId}`,
        );
        invalidatedOps.push(op);
      }
    }

    if (repairConcurrentPrefixOps.length > 0) {
      // A legacy repair cannot prove that concurrent prefix work is represented.
      // Move it just after the repair boundary so the full-state apply cannot
      // erase it. Preserve prefix order and keep all originally post-repair
      // operations after the replayed prefix.
      const repairIndex = validOps.lastIndexOf(latestImport);
      validOps.splice(repairIndex + 1, 0, ...repairConcurrentPrefixOps);
    }

    return {
      validOps,
      invalidatedOps,
      filteringImport: latestImport,
      isLocalUnsyncedImport,
    };
  }
}
