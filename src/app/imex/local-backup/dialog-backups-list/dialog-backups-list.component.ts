import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { T } from '../../../t.const';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { SnackService } from '../../../core/snack/snack.service';
import { BackupListEntry, BackupSourcesService } from '../backup-sources.service';

const KIND_ICON: Record<BackupListEntry['kind'], string> = {
  RECOVERY_POINT: 'history',
  BACKUP_FILE: 'folder',
  MOBILE_SLOT: 'smartphone',
};

/**
 * Settings → Sync & Backup → "Browse backups": every backup on this device
 * (recovery ring, Electron files, mobile slots) with a restore action.
 */
@Component({
  selector: 'dialog-backups-list',
  templateUrl: './dialog-backups-list.component.html',
  styleUrls: ['./dialog-backups-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [BackupSourcesService],
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslateModule,
    DatePipe,
    MatIcon,
    MatProgressSpinner,
  ],
})
export class DialogBackupsListComponent implements OnInit {
  private _dialogRef = inject(MatDialogRef<DialogBackupsListComponent>);
  private _matDialog = inject(MatDialog);
  private _snackService = inject(SnackService);
  private _sources = inject(BackupSourcesService);

  T = T;
  KIND_ICON = KIND_ICON;

  entries = signal<BackupListEntry[]>([]);
  selected = signal<BackupListEntry | null>(null);
  isLoading = signal(true);
  isRestoring = signal(false);
  /** Listing failed outright; replaces the list. */
  error = signal<string | null>(null);
  /** The last restore failed; shown above the list so another backup can be picked. */
  restoreError = signal<string | null>(null);
  /** Some source could not be read; the list is shown anyway but is partial. */
  isPartial = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const { entries, failedSources } = await this._sources.listBackups();
      this.entries.set(entries);
      this.isPartial.set(failedSources.length > 0);
      if (entries.length === 0 && failedSources.length > 0) {
        this.error.set(T.GCF.AUTO_BACKUPS.D_LIST.ERROR_LOADING);
      }
    } catch (e) {
      this.error.set(T.GCF.AUTO_BACKUPS.D_LIST.ERROR_LOADING);
    } finally {
      this.isLoading.set(false);
    }
  }

  async select(entry: BackupListEntry): Promise<void> {
    if (this.selected()?.id === entry.id) {
      this.selected.set(null);
      return;
    }
    this.selected.set(entry);
    if (entry.taskCount !== null) {
      return;
    }
    // A vanished file or failed IPC read only leaves the count unknown; the
    // restore itself reports its own error.
    const taskCount = await this._sources.loadTaskCount(entry).catch(() => null);
    const updated = { ...entry, taskCount };
    this.entries.update((all) => all.map((e) => (e.id === entry.id ? updated : e)));
    if (this.selected()?.id === entry.id) {
      this.selected.set(updated);
    }
  }

  async restore(): Promise<void> {
    const entry = this.selected();
    if (!entry) {
      return;
    }
    const confirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            title: T.GCF.AUTO_BACKUPS.D_LIST.CONFIRM_TITLE,
            message: T.GCF.AUTO_BACKUPS.D_LIST.CONFIRM_MSG,
            translateParams: {
              timestamp: entry.createdAt
                ? new Date(entry.createdAt).toLocaleString()
                : '—',
              tasks: entry.taskCount ?? '?',
            },
            titleIcon: 'warning',
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }

    this.isRestoring.set(true);
    this.restoreError.set(null);
    try {
      const didRestore = await this._sources.restore(entry);
      if (!didRestore) {
        this.restoreError.set(T.GCF.AUTO_BACKUPS.D_LIST.ERROR_RESTORE);
        return;
      }
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.GCF.AUTO_BACKUPS.S_RESTORE_SUCCESS,
      });
      this._dialogRef.close(true);
    } catch (e) {
      this.restoreError.set(T.GCF.AUTO_BACKUPS.D_LIST.ERROR_RESTORE);
    } finally {
      this.isRestoring.set(false);
    }
  }

  cancel(): void {
    this._dialogRef.close(false);
  }
}
