import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OpLog } from '../../core/log';
import { T } from '../../t.const';
import { confirmDialog } from '../../util/native-dialogs';
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';

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
   * @param ignoreTaskIds Optional task ids to exclude from the "has a task?" check.
   *   The file-based conflict gate passes the ids of pending onboarding example tasks so
   *   an example-only store is not treated as meaningful (#7985). Omitting it preserves
   *   the original behavior for every other caller.
   */
  hasMeaningfulStoreData(ignoreTaskIds?: ReadonlySet<string>): boolean {
    const snapshot = this.stateSnapshotService.getStateSnapshot();

    if (!snapshot) {
      OpLog.warn(
        'SyncLocalStateService.hasMeaningfulStoreData: Unable to get state snapshot',
      );
      return false;
    }

    return hasMeaningfulStateData(snapshot, ignoreTaskIds);
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
