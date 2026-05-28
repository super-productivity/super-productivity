import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OpLog } from '../../core/log';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';
import { T } from '../../t.const';
import { confirmDialog } from '../../util/native-dialogs';

const isEntityState = (obj: unknown): obj is { ids: string[] } =>
  typeof obj === 'object' &&
  obj !== null &&
  'ids' in obj &&
  Array.isArray((obj as { ids: unknown }).ids);

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

  hasMeaningfulStoreData(): boolean {
    const snapshot = this.stateSnapshotService.getStateSnapshot();

    if (!snapshot) {
      OpLog.warn(
        'SyncLocalStateService.hasMeaningfulStoreData: Unable to get state snapshot',
      );
      return false;
    }

    if (isEntityState(snapshot.task) && snapshot.task.ids.length > 0) {
      return true;
    }

    if (
      isEntityState(snapshot.project) &&
      snapshot.project.ids.some((id) => id !== INBOX_PROJECT.id)
    ) {
      return true;
    }

    if (
      isEntityState(snapshot.tag) &&
      snapshot.tag.ids.some((id) => !SYSTEM_TAG_IDS.has(id))
    ) {
      return true;
    }

    if (isEntityState(snapshot.note) && snapshot.note.ids.length > 0) {
      return true;
    }

    return false;
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
