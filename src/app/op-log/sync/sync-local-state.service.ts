import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OpLog } from '../../core/log';
import { T } from '../../t.const';
import { confirmDialog } from '../../util/native-dialogs';
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';
import {
  isFullStateOpType,
  isGenesisEntityType,
  Operation,
  OperationLogEntry,
} from '../core/operation.types';

/**
 * Legacy-migration and crash-recovery genesis ops carry this client's entire
 * state as an ordinary Batch op that replays as a no-op on every other client,
 * so the state they carry never reaches the server in a form another device
 * can apply. Only this client's own genesis counts: a raw rebuild from server
 * history (pre-#9921 uploads) can start with another device's genesis op.
 */
const isOwnGenesisOp = (entry: OperationLogEntry): boolean =>
  entry.source === 'local' && isGenesisEntityType(entry.op.entityType);

@Injectable({
  providedIn: 'root',
})
export class SyncLocalStateService {
  private opLogStore = inject(OperationLogStoreService);
  private stateSnapshotService = inject(StateSnapshotService);
  private translateService = inject(TranslateService);

  async isWhollyFreshClient(): Promise<boolean> {
    const snapshot = await this.opLogStore.loadStateCache();
    const lastSeq = await this.opLogStore.getLastSeq();

    return !snapshot && lastSeq === 0;
  }

  /**
   * A client whose op-log history starts with a MIGRATION or RECOVERY genesis op
   * and that has never completed a real sync (#9863).
   *
   * Such a client is NOT wholly fresh (the genesis wrote a state cache and one
   * op), so the fresh-client protections skip it, and server migration never
   * fires for it either (`hasSyncedOps()` ignores genesis ops). Yet its
   * pre-migration data exists only inside the genesis payload, which no other
   * client can replay. Callers must treat it like a fresh client that holds
   * local data: on a non-empty server the user has to choose a side, on an empty
   * server the state has to be seeded as a SYNC_IMPORT.
   *
   * Returns false once any full-state op exists locally: that op already ships
   * (or shipped) the state, and the caller's SYNC_IMPORT creation must not loop.
   */
  async isNeverSyncedGenesisClient(): Promise<boolean> {
    if (await this.opLogStore.hasSyncedOps()) {
      return false;
    }
    if (await this.opLogStore.getLatestFullStateOpEntry()) {
      return false;
    }
    const firstEntry = await this.opLogStore.getFirstOpEntry();
    return !!firstEntry && isOwnGenesisOp(firstEntry);
  }

  /**
   * Download-side "needs a full-state decision" check. Deliberately NOT folded
   * into isWhollyFreshClient(): that one also gates the upload phase, and a
   * genesis client must still upload the SYNC_IMPORT the empty-server branch
   * creates for it.
   *
   * When the download carries a full-state op, the incoming-import gate already
   * prompts a genesis client (its pending genesis op counts as meaningful work),
   * so the genesis case defers to that gate and keeps the established dialog.
   * Only the previously silent path — ordinary remote ops, no full-state op —
   * is widened here.
   */
  async isFreshOrNeverSyncedGenesisClient(incomingOps: Operation[]): Promise<boolean> {
    if (await this.isWhollyFreshClient()) {
      return true;
    }
    if (incomingOps.some((op) => isFullStateOpType(op.opType))) {
      return false;
    }
    return this.isNeverSyncedGenesisClient();
  }

  /**
   * The fresh-client / genesis-client gate: does this client hold user data?
   * Archives live only in IndexedDB and the synchronous snapshot substitutes an
   * empty DEFAULT_ARCHIVE, so an archive-only legacy client read as empty here
   * and lost its archive (#9932); when the NgRx slices hold nothing, the
   * archive-inclusive snapshot is consulted before answering "no".
   *
   * @param ignoreTaskIds Optional task ids to exclude from the "has a task?" check.
   *   The file-based conflict gate passes the ids of pending onboarding example tasks so
   *   an example-only store is not treated as meaningful (#7985). Omitting it preserves
   *   the original behavior for every other caller.
   */
  async hasMeaningfulStoreData(ignoreTaskIds?: ReadonlySet<string>): Promise<boolean> {
    const snapshot = this.stateSnapshotService.getStateSnapshot();

    if (!snapshot) {
      OpLog.warn(
        'SyncLocalStateService.hasMeaningfulStoreData: Unable to get state snapshot',
      );
      return false;
    }

    if (hasMeaningfulStateData(snapshot, ignoreTaskIds)) {
      return true;
    }

    const withArchives = await this.stateSnapshotService.getStateSnapshotAsync();
    return hasMeaningfulStateData(withArchives, ignoreTaskIds);
  }

  confirmFreshClientSync(opCount: number): boolean {
    const title = this.translateService.instant(T.F.SYNC.D_FRESH_CLIENT_CONFIRM.TITLE);
    const message = this.translateService.instant(
      T.F.SYNC.D_FRESH_CLIENT_CONFIRM.MESSAGE,
      {
        count: opCount,
      },
    );
    return confirmDialog(`${title}\n\n${message}`);
  }
}
