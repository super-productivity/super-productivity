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
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

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
  private _dateTimeFormatService = inject(DateTimeFormatService);
  data = inject<ConflictData>(MAT_DIALOG_DATA);

  // Exposed so the template can pass the reactive locale to the now-pure
  // `localeDate` pipe, preserving re-render on a locale change.
  readonly locale = this._dateTimeFormatService.currentLocale;

  T: typeof T = T;

  remote = this.data.remote;
  local = this.data.local;

  isHighlightRemote =
    this.remote.lastUpdate !== null && this.remote.lastUpdate > this.local.lastUpdate;
  isHighlightLocal =
    this.remote.lastUpdate !== null && this.local.lastUpdate > this.remote.lastUpdate;

  remoteChangeCount = this.getChangeCount('remote');
  localChangeCount = this.getLocalChangeCount();

  isHighlightRemoteChanges =
    this.remoteChangeCount !== null &&
    this.localChangeCount !== null &&
    this.remoteChangeCount > this.localChangeCount;
  isHighlightLocalChanges =
    this.remoteChangeCount !== null &&
    this.localChangeCount !== null &&
    this.localChangeCount > this.remoteChangeCount;

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

  /**
   * Number of changes on the given side since the last successful sync,
   * computed as a per-client vector-clock delta.
   *
   * Returns `null` when no last-synced baseline is available (a
   * never-synced/fresh client). We deliberately do NOT sum the whole clock as
   * a fallback: vector-clock counters are per-client LIFETIME totals, so
   * summing reports total ops ever performed (thousands), not changes since
   * last sync (SPAP-7). A null result is rendered as "unknown" in the UI.
   */
  private getChangeCount(side: 'remote' | 'local'): number | null {
    if (!this.remote.vectorClock || !this.local.vectorClock) {
      return null;
    }

    const clock = side === 'remote' ? this.remote.vectorClock : this.local.vectorClock;
    const lastSyncedClock = this.local.lastSyncedVectorClock;

    // No last-synced baseline → changes-since-sync is genuinely unknown.
    if (!lastSyncedClock) {
      return null;
    }

    // Calculate changes since last sync (per-client delta).
    let changeCount = 0;
    for (const [clientId, value] of Object.entries(clock)) {
      const lastSyncedValue = lastSyncedClock[clientId] || 0;
      changeCount += Math.max(0, value - lastSyncedValue);
    }
    return changeCount;
  }

  /**
   * Local change count. Prefers the EXACT pending-op count measured from the
   * op log over the vector-clock delta: compaction can fold still-unsynced ops
   * into the last-synced baseline clock, so the delta can under-count real
   * pending changes (e.g. report 0 while N unsynced ops exist — which also
   * wrongly skipped the secondary overwrite confirmation). The measured count
   * is precisely "what USE_REMOTE would discard", so it is the decision-relevant
   * figure; the delta remains the fallback for producers that don't supply it.
   */
  private getLocalChangeCount(): number | null {
    return this.data.localUnsyncedOpsCount ?? this.getChangeCount('local');
  }

  private shouldConfirmOverwrite(resolution: DialogConflictResolutionResult): boolean {
    const remoteChanges = this.remoteChangeCount;
    const localChanges = this.localChangeCount;

    // If we cannot quantify the changes (fresh client, no last-synced
    // baseline), still show the confirmation — overwriting could discard real
    // data. The message is worded without a count (see getConfirmationMessage).
    if (remoteChanges === null || localChanges === null) {
      return resolution === 'USE_REMOTE' || resolution === 'USE_LOCAL';
    }

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
    const remoteChanges = this.remoteChangeCount;
    const localChanges = this.localChangeCount;

    const [sourceName, targetName] =
      resolution === 'USE_REMOTE' ? ['remote', 'local'] : ['local', 'remote'];

    // Without a known change count, use the count-free warning wording.
    if (remoteChanges === null || localChanges === null) {
      return this._translateService.instant(
        T.F.SYNC.D_CONFLICT.OVERWRITE_WARNING_UNKNOWN,
        { targetName, sourceName },
      );
    }

    const [sourceChanges, targetChanges] =
      resolution === 'USE_REMOTE'
        ? [remoteChanges, localChanges]
        : [localChanges, remoteChanges];

    return this._translateService.instant(T.F.SYNC.D_CONFLICT.OVERWRITE_WARNING, {
      targetName,
      targetChanges,
      sourceName,
      sourceChanges,
    });
  }
}
