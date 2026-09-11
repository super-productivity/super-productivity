import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OpLog } from '../../core/log';
import { T } from '../../t.const';
import { alertDialog, confirmDialog } from '../../util/native-dialogs';
import {
  hasAnyUserData,
  hasMeaningfulStateData,
} from '../validation/has-meaningful-state-data.util';
import { isExampleTaskCreateOp } from '../validation/is-example-task-op.util';
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

/**
 * Archived tasks are the user's work even though `hasMeaningfulStateData` does
 * not look at them (#9256). Both buckets are read: archiveOld holds anything
 * aged out of archiveYoung.
 */
const hasArchivedTasks = (snapshot: {
  archiveYoung?: { task?: { ids?: readonly string[] } };
  archiveOld?: { task?: { ids?: readonly string[] } };
}): boolean =>
  (snapshot.archiveYoung?.task?.ids?.length ?? 0) > 0 ||
  (snapshot.archiveOld?.task?.ids?.length ?? 0) > 0;

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
   * Uses the wider `hasAnyUserData`, because a legacy-migrated client's work can
   * be entirely archived, tracked time or repeat configs. Archives live only in
   * IndexedDB and the synchronous snapshot substitutes an empty DEFAULT_ARCHIVE,
   * so such a client read as empty here and lost its archive (#9932); when the
   * narrow check finds nothing, the archive-inclusive snapshot is consulted
   * before answering "no".
   *
   * The wider notion stops here on purpose. `hasNothingWorthUploading` below
   * consumes the narrow `hasMeaningfulStateData` in the refusing direction
   * (#9256), where over-reporting "has data" would permit a destructive server
   * overwrite from a device holding nothing.
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

    if (hasAnyUserData(snapshot, ignoreTaskIds)) {
      return true;
    }

    const withArchives = await this.stateSnapshotService.getStateSnapshotAsync();
    return hasAnyUserData(withArchives, ignoreTaskIds);
  }

  /**
   * True when this device has nothing of its own to put on the server (#9256).
   *
   * The destructive recovery actions ("Overwrite Server & Other Devices",
   * "Use Local Data") replace the remote copy with this device's state via a
   * clean-slate SYNC_IMPORT, which makes the server DELETE its stored
   * operations rather than supersede them. Running one from a device that
   * holds nothing therefore destroys the user's only copy, irreversibly — the
   * exact trap a client stuck on a failed initial download is offered.
   *
   * Two signals, both required:
   * - never completed a sync, so this device cannot be holding anything it
   *   received. A device that HAS synced may legitimately hold real data, so
   *   this keeps deliberate resets (Settings -> Sync) working.
   * - no user data beyond the onboarding example tasks. Those are generated
   *   locally on first run and are not the user's work, so they must not make
   *   an empty device look non-empty — `afterInitialSyncDoneStrict$` fails open
   *   on a timer, so they are created even when the initial sync failed.
   *
   * Archives are checked explicitly rather than through `hasMeaningfulStateData`.
   * That util's scope is deliberately narrow (task / project / tag / note) and
   * its doc states it is only ever consumed in the "safe" direction, where a
   * false negative merely skips work. This caller is the first to consume it in
   * the REFUSING direction, where a false negative blocks a legitimate
   * overwrite — so a device whose work is entirely archived must not be
   * reported as holding nothing. The synchronous snapshot substitutes
   * DEFAULT_ARCHIVE, hence the async read here.
   *
   * Fails closed: an unreadable snapshot counts as "nothing to upload" and
   * refuses. Refusing can never destroy data; guessing "has data" can.
   */
  async hasNothingWorthUploading(): Promise<boolean> {
    if (await this.opLogStore.hasSyncedOps()) {
      return false;
    }

    const pendingOps = await this.opLogStore.getUnsynced();
    const exampleTaskIds = new Set(
      pendingOps
        .filter(isExampleTaskCreateOp)
        .map((entry) => entry.op.entityId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );

    const snapshot = await this.stateSnapshotService.getStateSnapshotAsync();
    if (!snapshot) {
      OpLog.warn(
        'SyncLocalStateService.hasNothingWorthUploading: no state snapshot - refusing',
      );
      return true;
    }

    if (hasMeaningfulStateData(snapshot, exampleTaskIds)) {
      return false;
    }

    return !hasArchivedTasks(snapshot);
  }

  /**
   * Shows the refusal for `hasNothingWorthUploading()` and records that it
   * fired. The log line is the only evidence channel this class of bug has —
   * a #9256-shaped report cannot otherwise be confirmed from an exported log —
   * and carries no user content (rule 9).
   *
   * `messageKey` lets each entry point supply its own "what to do next": the
   * recovery dialogs tell the user to retry the password, which would be
   * nonsense in the change-password dialog.
   */
  warnNothingWorthUploading(
    messageKey: string = T.F.SYNC.D_NOTHING_TO_UPLOAD.MESSAGE,
  ): void {
    OpLog.warn(
      'SyncLocalStateService: refused a destructive server overwrite - this device has nothing worth uploading',
    );
    alertDialog(
      this.translateService.instant(T.F.SYNC.D_NOTHING_TO_UPLOAD.TITLE) +
        '\n\n' +
        this.translateService.instant(messageKey),
    );
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
