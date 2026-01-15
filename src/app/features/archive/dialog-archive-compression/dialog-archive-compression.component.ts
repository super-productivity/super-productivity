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
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import {
  ArchiveCompressionService,
  CompressionPreview,
} from '../archive-compression.service';
import { compressArchive } from '../store/archive.actions';
import { T } from '../../../t.const';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Component({
  selector: 'dialog-archive-compression',
  templateUrl: './dialog-archive-compression.component.html',
  styleUrls: ['./dialog-archive-compression.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslateModule,
    MatIcon,
    MatProgressSpinner,
  ],
})
export class DialogArchiveCompressionComponent implements OnInit {
  private _dialogRef = inject(MatDialogRef<DialogArchiveCompressionComponent>);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _compressionService = inject(ArchiveCompressionService);

  T = T;

  preview = signal<CompressionPreview | null>(null);
  isLoading = signal(true);
  isCompressing = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const oneYearAgo = Date.now() - ONE_YEAR_MS;
      const previewData =
        await this._compressionService.getCompressionPreview(oneYearAgo);
      this.preview.set(previewData);
    } catch (err) {
      this.error.set((err as Error).message || 'Failed to load preview');
    } finally {
      this.isLoading.set(false);
    }
  }

  hasDataToCompress(): boolean {
    const p = this.preview();
    if (!p) return false;
    return p.subtasksToDelete > 0 || p.notesToClear > 0 || p.issueFieldsToClear > 0;
  }

  async compress(): Promise<void> {
    const confirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            title: T.F.TIME_TRACKING.D_ARCHIVE_COMPRESS.CONFIRM_TITLE,
            message: T.F.TIME_TRACKING.D_ARCHIVE_COMPRESS.CONFIRM_MSG,
            titleIcon: 'warning',
          },
        })
        .afterClosed(),
    );

    if (!confirmed) {
      return;
    }

    this.isCompressing.set(true);
    try {
      const now = Date.now();
      const oneYearAgo = now - ONE_YEAR_MS;

      this._store.dispatch(
        compressArchive({
          timestamp: now,
          oneYearAgoTimestamp: oneYearAgo,
        }),
      );

      this._dialogRef.close(true);
    } catch (err) {
      this.error.set((err as Error).message || 'Failed to compress');
      this.isCompressing.set(false);
    }
  }

  cancel(): void {
    this._dialogRef.close(false);
  }
}
