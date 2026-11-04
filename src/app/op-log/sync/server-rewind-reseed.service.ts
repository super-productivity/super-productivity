import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { FULL_STATE_OP_TYPES, OperationLogEntry, OpType } from '../core/operation.types';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { OpLog } from '../../core/log';

const LIST_PAGE_SIZE = 500;
/** Same runaway guard the regular download uses (50 pages × 500 ops). */
const MAX_LIST_PAGES = 50;

/** What the server still holds of this client's history after a restore. */
export interface ServerHeldOwnOps {
  /** Ids of this client's ops on the server, from its latest full-state op on. */
  ownOpIds: ReadonlySet<string>;
  /**
   * Highest counter for this client in a full-state op on the server. Own ops
   * at or below it are part of that snapshot, never uploaded on their own.
   */
  ownCounterInFullState: number;
}

/**
 * This client's acknowledged ops that a server restore lost (#11467).
 *
 * Considers only ops after the latest local full-state op (older ones are
 * replaced by it). An op is lost when the server no longer has it and no
 * full-state op on the server covers it. Full-state ops are left alone: a
 * re-upload would collide with the server's own import (SYNC_IMPORT_EXISTS).
 */
export const selectOwnOpsLostByServerRewind = (
  entries: readonly OperationLogEntry[],
  clientId: string,
  held: ServerHeldOwnOps,
): string[] =>
  entries
    .filter(
      (entry) =>
        entry.source === 'local' &&
        entry.op.clientId === clientId &&
        entry.syncedAt !== undefined &&
        entry.rejectedAt === undefined &&
        entry.reducerRejectedAt === undefined &&
        !FULL_STATE_OP_TYPES.has(entry.op.opType as OpType) &&
        !held.ownOpIds.has(entry.op.id) &&
        (entry.op.vectorClock[clientId] ?? 0) > held.ownCounterInFullState,
    )
    .map((entry) => entry.op.id);

/**
 * Re-seeds a SuperSync server that was restored to an earlier point (#11467).
 *
 * A restored server is behind this client's cursor but not empty, so neither
 * the empty-server SYNC_IMPORT nor the ordinary upload runs: ops this client
 * uploaded after the backup stay marked synced and never reach other devices.
 * This lists what the server still holds (including this client's own ops,
 * which a normal download excludes) and re-queues the missing ones for the
 * ordinary upload. The server deduplicates by op id and runs its usual
 * conflict checks, so re-sending is safe. Each device re-seeds only its own
 * ops; other devices do the same on their next sync.
 */
@Injectable({ providedIn: 'root' })
export class ServerRewindReseedService {
  private opLogStore = inject(OperationLogStoreService);

  /** @returns how many ops were re-queued for upload. */
  async requeueOwnOpsLostByRewind(
    syncProvider: OperationSyncCapable,
    clientId: string,
  ): Promise<number> {
    const held = await this._listServerHeldOwnOps(syncProvider, clientId);
    const latestFullState = await this.opLogStore.getLatestFullStateOpEntry();
    const entries = await this.opLogStore.getOpsAfterSeq(latestFullState?.seq ?? 0);
    const lostOpIds = selectOwnOpsLostByServerRewind(entries, clientId, held);
    if (lostOpIds.length > 0) {
      await this.opLogStore.markUnsynced(lostOpIds);
    }
    OpLog.warn(
      `ServerRewindReseedService: Server was restored to an earlier point; ` +
        `re-queued ${lostOpIds.length} op(s) it no longer has.`,
    );
    return lostOpIds.length;
  }

  private async _listServerHeldOwnOps(
    syncProvider: OperationSyncCapable,
    clientId: string,
  ): Promise<ServerHeldOwnOps> {
    const ownOpIds = new Set<string>();
    let ownCounterInFullState = 0;
    let sinceSeq = 0;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      // No excludeClient: this client's own ops are exactly what we need.
      const response = await syncProvider.downloadOps(
        sinceSeq,
        undefined,
        LIST_PAGE_SIZE,
      );
      for (const { op } of response.ops) {
        if (op.clientId === clientId) ownOpIds.add(op.id);
        if (FULL_STATE_OP_TYPES.has(op.opType as OpType)) {
          ownCounterInFullState = Math.max(
            ownCounterInFullState,
            op.vectorClock?.[clientId] ?? 0,
          );
        }
      }
      const lastSeq = response.ops[response.ops.length - 1]?.serverSeq;
      if (!response.hasMore || lastSeq === undefined || lastSeq <= sinceSeq) break;
      sinceSeq = lastSeq;
    }
    // A list cut short only re-sends ops the server still has; it answers
    // those with DUPLICATE_OPERATION and the client marks them synced again.
    return { ownOpIds, ownCounterInFullState };
  }
}
