import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { download } from '../../../util/download';

import { IS_ELECTRON } from '../../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { BackupService } from '../../../op-log/backup/backup.service';
import { T } from '../../../t.const';
import { Log } from '../../../core/log';

export type DialogSyncErrorType = 'incomplete-sync' | 'incoherent-timestamps';

export interface DialogSyncErrorData {
  type: DialogSyncErrorType;
  modelId?: string;
}

export type DialogSyncErrorResult =
  | 'FORCE_UPDATE_REMOTE'
  | 'FORCE_UPDATE_LOCAL'
  | undefined;

@Component({
  selector: 'dialog-sync-error',
  imports: [MatDialogContent, TranslateModule, MatIcon, MatDialogActions, MatButton],
  templateUrl: './dialog-sync-error.component.html',
  styleUrl: './dialog-sync-error.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogSyncErrorComponent {
  private _matDialogRef = inject<MatDialogRef<DialogSyncErrorComponent>>(MatDialogRef);
  private _backupService = inject(BackupService);

  data = inject<DialogSyncErrorData>(MAT_DIALOG_DATA);

  T: typeof T = T;
  IS_ANDROID_WEB_VIEW = IS_ANDROID_WEB_VIEW;

  constructor() {
    this._matDialogRef.disableClose = true;
  }

  async downloadBackup(): Promise<void> {
    const data = await this._backupService.loadCompleteBackup(true);
    try {
      await download('super-productivity-backup.json', JSON.stringify(data));
    } catch (e) {
      Log.error(e);
    }
  }

  close(res?: DialogSyncErrorResult): void {
    this._matDialogRef.close(res);
  }

  closeApp(): void {
    if (IS_ELECTRON) {
      window.ea.shutdownNow();
    } else {
      window.close();
    }
  }
}
