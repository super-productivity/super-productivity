import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { combineLatest, from, Subscription } from 'rxjs';
import { concatMap, filter, first, skip } from 'rxjs/operators';
import { selectAllTasks } from '../../../features/tasks/store/task.selectors';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { DialogSyncFinishedComponent } from '../dialog-sync-finished/dialog-sync-finished.component';
import { SyncWrapperService } from '../sync-wrapper.service';

/**
 * Shows "Sync is on" once after signing in from the sign-in dialog, as soon as
 * this device is confirmed in sync with an encryption password set. Session
 * only: nothing is saved, so the screen never shows on a later launch.
 */
@Injectable({ providedIn: 'root' })
export class SuperSyncFinishService {
  private _syncWrapper = inject(SyncWrapperService);
  private _providerManager = inject(SyncProviderManager);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _waiting?: Subscription;

  /** Waits for the first clean sync after sign-in, then shows the screen once. */
  arm(): void {
    if (this._waiting && !this._waiting.closed) {
      return;
    }
    this._waiting = combineLatest([
      // Skip the replayed state: an "in sync" from before this sign-in says
      // nothing about the sync it starts.
      this._syncWrapper.syncState$.pipe(skip(1)),
      this._syncWrapper.superSyncIsConfirmedInSync$,
    ])
      .pipe(
        filter(([state, isConfirmed]) => state === 'IN_SYNC' && isConfirmed),
        concatMap(() => from(this._isReady())),
        filter(Boolean),
        first(),
        concatMap(() => this._store.select(selectAllTasks).pipe(first())),
      )
      .subscribe((tasks) => {
        this._matDialog.open(DialogSyncFinishedComponent, {
          data: { taskCount: tasks.length },
        });
      });
  }

  private async _isReady(): Promise<boolean> {
    // An open dialog comes first: the setup password, the unlock step or the
    // local-data choice. Closing it syncs again, which re-runs this check.
    if (this._matDialog.openDialogs.length > 0) {
      return false;
    }
    const provider = this._providerManager.getActiveProvider();
    if (provider?.id !== SyncProviderId.SuperSync) {
      return false;
    }
    // Without a password nothing is uploaded yet, so sync isn't on.
    const cfg = (await provider.privateCfg.load()) as {
      isEncryptionEnabled?: boolean;
      encryptKey?: string;
    } | null;
    return !!cfg?.isEncryptionEnabled && !!cfg.encryptKey;
  }
}
