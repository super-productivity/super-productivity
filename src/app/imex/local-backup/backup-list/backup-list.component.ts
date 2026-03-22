import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
} from '@angular/core';
import { LocalBackupService } from '../local-backup.service';
import { LocalBackupMeta } from '../local-backup.model';
import { BackupService } from '../../../op-log/backup/backup.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { Log } from '../../../core/log';
import { confirmDialog } from '../../../util/native-dialogs';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';

@Component({
  selector: 'backup-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TranslatePipe, CollapsibleComponent],
  template: `
    <collapsible
      [title]="T.GCF.AUTO_BACKUPS.BACKUP_LIST_TITLE | translate"
      [isIconBefore]="true"
      (isExpandedChange)="onExpandedChange($event)"
    >
      @if (backups.length > 0) {
        <table>
          <tr>
            <th>{{ T.GCF.AUTO_BACKUPS.BACKUP_DATE | translate }}</th>
            <th></th>
          </tr>
          @for (backup of backups; track backup.path) {
            <tr>
              <td>{{ backup.created | date: 'medium' }}</td>
              <td>
                <a
                  href="#"
                  (click)="restoreBackup(backup); $event.preventDefault()"
                  >{{ T.GCF.AUTO_BACKUPS.RESTORE | translate }}</a
                >
              </td>
            </tr>
          }
        </table>
      } @else if (loaded) {
        <p>{{ T.GCF.AUTO_BACKUPS.NO_BACKUPS | translate }}</p>
      }
    </collapsible>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-top: 8px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        text-align: left;
        padding: 4px 8px;
      }
      td {
        padding: 4px 8px;
      }
      a {
        cursor: pointer;
      }
    `,
  ],
})
export class BackupListComponent {
  private _localBackupService = inject(LocalBackupService);
  private _backupService = inject(BackupService);
  private _snackService = inject(SnackService);
  private _cd = inject(ChangeDetectorRef);

  T = T;
  backups: LocalBackupMeta[] = [];
  loaded = false;

  onExpandedChange(isExpanded: boolean): void {
    if (isExpanded && !this.loaded) {
      this._loadBackups();
    }
  }

  async restoreBackup(backup: LocalBackupMeta): Promise<void> {
    if (
      !confirmDialog(`Restore backup from ${new Date(backup.created).toLocaleString()}?`)
    ) {
      return;
    }
    try {
      const backupData = await this._localBackupService.loadBackupElectron(backup.path);
      await this._backupService.importCompleteBackup(
        JSON.parse(backupData) as AppDataComplete,
        false,
        true,
        true,
      );
    } catch (e) {
      Log.err('Failed to restore backup', e);
      this._snackService.open({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_IMPORT_FAILED,
      });
    }
  }

  private async _loadBackups(): Promise<void> {
    this.backups = await this._localBackupService.listBackups();
    this.loaded = true;
    this._cd.markForCheck();
  }
}
