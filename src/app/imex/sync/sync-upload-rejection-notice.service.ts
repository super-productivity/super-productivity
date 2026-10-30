import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { T } from '../../t.const';

/** Rejected sync cycles in a row before the streak is surfaced. */
export const REJECTED_UPLOAD_CYCLES_BEFORE_NOTICE = 3;

/**
 * A cycle ending in `UploadRevToMatchMismatchAPIError` (the adapter already
 * re-downloaded and retried inside it) usually means another device uploaded
 * first; the next cycle resolves that silently. When it repeats cycle after
 * cycle, uploads keep failing for a reason the next download does not fix —
 * e.g. a server rewriting ETags (#10808) or a truncated write — and local
 * changes never leave the device. Say so once per streak and keep the sync
 * icon on error; retries continue unchanged. Any sync that reaches IN_SYNC,
 * on whichever path, ends the streak.
 */
@Injectable({ providedIn: 'root' })
export class SyncUploadRejectionNoticeService {
  private _providerManager = inject(SyncProviderManager);
  private _snackService = inject(SnackService);
  private _rejectedCycles = 0;
  private _hasShownNotice = false;

  private _resetOnInSync = this._providerManager.syncStatus$
    .pipe(
      filter((status) => status === 'IN_SYNC'),
      takeUntilDestroyed(),
    )
    .subscribe(() => this._reset());

  onUploadRejected(): void {
    this._rejectedCycles++;
    if (this._rejectedCycles < REJECTED_UPLOAD_CYCLES_BEFORE_NOTICE) {
      this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
      return;
    }
    this._providerManager.setSyncStatus('ERROR');
    if (!this._hasShownNotice && !this._snackService.hasPendingPersistentAction()) {
      this._hasShownNotice = true;
      this._snackService.open({
        msg: T.F.SYNC.S.UPLOAD_REJECTED_REPEATEDLY,
        type: 'ERROR',
        config: { duration: 12000 },
      });
    }
  }

  private _reset(): void {
    this._rejectedCycles = 0;
    this._hasShownNotice = false;
  }
}
