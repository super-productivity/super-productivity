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
import { SuperSyncRestoreService } from '../super-sync-restore.service';
import { RestorePoint } from '../../../op-log/sync-providers/provider.interface';
import { T } from '../../../t.const';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'dialog-restore-point',
  templateUrl: './dialog-restore-point.component.html',
  styleUrls: ['./dialog-restore-point.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
export class DialogRestorePointComponent implements OnInit {
  private _dialogRef = inject(MatDialogRef<DialogRestorePointComponent>);
  private _matDialog = inject(MatDialog);
  private _restoreService = inject(SuperSyncRestoreService);

  T = T;

  restorePoints = signal<RestorePoint[]>([]);
  selectedPoint = signal<RestorePoint | null>(null);
  isLoading = signal(true);
  isRestoring = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const points = await this._restoreService.getRestorePoints();
      this.restorePoints.set(points);
    } catch (err) {
      this.error.set(T.F.SYNC.D_RESTORE.ERROR_LOADING);
    } finally {
      this.isLoading.set(false);
    }
  }

  selectPoint(point: RestorePoint): void {
    if (this.selectedPoint()?.serverSeq === point.serverSeq) {
      this.selectedPoint.set(null);
    } else {
      this.selectedPoint.set(point);
    }
  }

  async restore(): Promise<void> {
    const point = this.selectedPoint();
    if (!point) {
      return;
    }

    const timestamp = new Date(point.timestamp).toLocaleString();
    const confirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            title: T.F.SYNC.D_RESTORE.CONFIRM_TITLE,
            message: T.F.SYNC.D_RESTORE.CONFIRM_MSG,
            translateParams: { timestamp },
            titleIcon: 'warning',
          },
        })
        .afterClosed(),
    );

    if (!confirmed) {
      return;
    }

    this.isRestoring.set(true);
    try {
      await this._restoreService.restoreToPoint(point.serverSeq);
      this._dialogRef.close(true);
    } catch (err) {
      this.error.set(T.F.SYNC.D_RESTORE.ERROR_RESTORE);
      this.isRestoring.set(false);
    }
  }

  cancel(): void {
    this._dialogRef.close(false);
  }

  getTypeIcon(type: RestorePoint['type']): string {
    switch (type) {
      case 'SYNC_IMPORT':
        return 'cloud_download';
      case 'BACKUP_IMPORT':
        return 'backup';
      case 'REPAIR':
        return 'build';
      default:
        return 'history';
    }
  }

  getTypeLabel(type: RestorePoint['type']): string {
    switch (type) {
      case 'SYNC_IMPORT':
        return T.F.SYNC.D_RESTORE.TYPE_SYNC_IMPORT;
      case 'BACKUP_IMPORT':
        return T.F.SYNC.D_RESTORE.TYPE_BACKUP_IMPORT;
      case 'REPAIR':
        return T.F.SYNC.D_RESTORE.TYPE_REPAIR;
      default:
        return type;
    }
  }
}
