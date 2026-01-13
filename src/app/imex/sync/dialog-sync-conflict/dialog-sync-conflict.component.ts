import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from 'src/app/t.const';
import { DialogConflictResolutionResult } from '../sync.model';
import { ConflictData, VectorClock } from '../../../op-log/sync-exports';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { MatTooltip } from '@angular/material/tooltip';
import { ShortTimePipe } from '../../../ui/pipes/short-time.pipe';
import {
  compareVectorClocks,
  VectorClockComparison,
  vectorClockToString,
} from '../../../core/util/vector-clock';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';

@Component({
  selector: 'dialog-sync-conflict',
  templateUrl: './dialog-sync-conflict.component.html',
  styleUrls: ['./dialog-sync-conflict.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    LocaleDatePipe,
    ShortTimePipe,
    MatTooltip,
    CollapsibleComponent,
  ],
})
export class DialogSyncConflictComponent {
  private _matDialogRef = inject<MatDialogRef<DialogSyncConflictComponent>>(MatDialogRef);
  private _matDialog = inject(MatDialog);
  private _translateService = inject(TranslateService);
  data = inject<ConflictData>(MAT_DIALOG_DATA);

  T: typeof T = T;

  remote = this.data.remote;
  local = this.data.local;

  isHighlightRemote = this.remote.lastUpdate >= this.local.lastUpdate;
  isHighlightLocal = !this.isHighlightRemote;

  remoteChangeCount = this.getChangeCount('remote');
  localChangeCount = this.getChangeCount('local');

  isHighlightRemoteChanges = this.remoteChangeCount > this.localChangeCount;
  isHighlightLocalChanges = !this.isHighlightRemoteChanges;

  constructor() {
    this._matDialogRef.disableClose = true;
  }

  close(res?: DialogConflictResolutionResult): void {
    if (res && this.shouldConfirmOverwrite(res)) {
      const confirmMessage = this.getConfirmationMessage(res);

      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            message: confirmMessage,
            translateParams: {},
            okBtnLabel: this.T.G.OK,
            cancelBtnLabel: this.T.G.CANCEL,
          },
        })
        .afterClosed()
        .subscribe((isConfirm) => {
          if (isConfirm) {
            this._matDialogRef.close(res);
          }
        });
    } else {
      this._matDialogRef.close(res);
    }
  }

  shortenAction(actionStr?: string | null): string {
    if (!actionStr) return '?';
    return actionStr.trim().split(/\s+/)[0];
  }

  getVectorClockComparison(): VectorClockComparison | null {
    if (!this.local.vectorClock || !this.remote.vectorClock) {
      return null;
    }
    return compareVectorClocks(this.local.vectorClock, this.remote.vectorClock);
  }

  getVectorClockString(clock?: VectorClock | null): string {
    if (!clock) return '-';
    return vectorClockToString(clock);
  }

  getVectorClockComparisonLabel(): string {
    const comparison = this.getVectorClockComparison();
    if (!comparison) return '-';
    switch (comparison) {
      case VectorClockComparison.EQUAL:
        return this.T.F.SYNC.D_CONFLICT.VECTOR_COMPARISON_EQUAL;
      case VectorClockComparison.LESS_THAN:
        return this.T.F.SYNC.D_CONFLICT.VECTOR_COMPARISON_LOCAL_LESS;
      case VectorClockComparison.GREATER_THAN:
        return this.T.F.SYNC.D_CONFLICT.VECTOR_COMPARISON_LOCAL_GREATER;
      case VectorClockComparison.CONCURRENT:
        return this.T.F.SYNC.D_CONFLICT.VECTOR_COMPARISON_CONCURRENT;
      default:
        return '-';
    }
  }

  private getChangeCount(side: 'remote' | 'local'): number {
    // First try vector clock, fall back to Lamport if not available
    if (this.remote.vectorClock && this.local.vectorClock) {
      const clock = side === 'remote' ? this.remote.vectorClock : this.local.vectorClock;
      const lastSyncedClock = this.local.lastSyncedVectorClock;

      if (!clock) return 0;

      // If no last synced clock, return total of all values
      if (!lastSyncedClock) {
        return Object.values(clock).reduce((sum, value) => sum + value, 0);
      }

      // Calculate changes since last sync
      let changeCount = 0;
      for (const [clientId, value] of Object.entries(clock)) {
        const lastSyncedValue = lastSyncedClock[clientId] || 0;
        changeCount += Math.max(0, value - lastSyncedValue);
      }
      return changeCount;
    }

    // No vector clock available
    return 0;
  }

  private shouldConfirmOverwrite(resolution: DialogConflictResolutionResult): boolean {
    const remoteChanges = this.getChangeCount('remote');
    const localChanges = this.getChangeCount('local');

    const MIN_CHANGES_DIFFERENCE = 20;

    if (resolution === 'USE_REMOTE') {
      // User wants to use remote, but local has significantly more changes
      return localChanges - remoteChanges >= MIN_CHANGES_DIFFERENCE;
    } else if (resolution === 'USE_LOCAL') {
      // User wants to use local, but remote has significantly more changes
      return remoteChanges - localChanges >= MIN_CHANGES_DIFFERENCE;
    }

    return false;
  }

  private getConfirmationMessage(resolution: DialogConflictResolutionResult): string {
    const remoteChanges = this.getChangeCount('remote');
    const localChanges = this.getChangeCount('local');
    const [sourceChanges, targetChanges, sourceName, targetName] =
      resolution === 'USE_REMOTE'
        ? [remoteChanges, localChanges, 'remote', 'local']
        : [localChanges, remoteChanges, 'local', 'remote'];

    return this._translateService.instant(T.F.SYNC.D_CONFLICT.OVERWRITE_WARNING, {
      targetName,
      targetChanges,
      sourceName,
      sourceChanges,
    });
  }
}
