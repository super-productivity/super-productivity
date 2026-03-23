import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { debounceTime, exhaustMap, filter } from 'rxjs/operators';
import { SuperSyncWebSocketService } from './super-sync-websocket.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { WrappedProviderService } from '../sync-providers/wrapped-provider.service';
import { SyncLog } from '../../core/log';
import { AuthFailSPError, MissingCredentialsSPError } from '../sync-exports';

const WS_DOWNLOAD_DEBOUNCE_MS = 500;

/**
 * Triggers operation downloads when WebSocket notifications arrive.
 *
 * Pipeline: newOpsNotification$ → filter(!syncInProgress) → debounce(500ms) → exhaustMap(download)
 *
 * Uses exhaustMap to ignore new notifications while a download is in progress.
 * The existing OperationLogDownloadService handles the actual download - no new code path.
 */
@Injectable({
  providedIn: 'root',
})
export class WsTriggeredDownloadService implements OnDestroy {
  private _wsService = inject(SuperSyncWebSocketService);
  private _syncService = inject(OperationLogSyncService);
  private _providerManager = inject(SyncProviderManager);
  private _wrappedProvider = inject(WrappedProviderService);

  private _subscription: Subscription | null = null;

  start(): void {
    if (this._subscription) {
      return;
    }

    this._subscription = this._wsService.newOpsNotification$
      .pipe(
        filter(() => !this._providerManager.isSyncInProgress),
        debounceTime(WS_DOWNLOAD_DEBOUNCE_MS),
        exhaustMap((notification) => this._downloadOps(notification.latestSeq)),
      )
      .subscribe();

    SyncLog.log('WsTriggeredDownloadService: Started listening for WS notifications');
  }

  stop(): void {
    this._subscription?.unsubscribe();
    this._subscription = null;
    SyncLog.log('WsTriggeredDownloadService: Stopped');
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private async _downloadOps(latestSeq: number): Promise<void> {
    try {
      const rawProvider = this._providerManager.getActiveProvider();
      if (!rawProvider) {
        return;
      }

      const syncCapableProvider =
        await this._wrappedProvider.getOperationSyncCapable(rawProvider);
      if (!syncCapableProvider) {
        return;
      }

      SyncLog.log(
        `WsTriggeredDownloadService: Downloading ops triggered by WS notification (latestSeq=${latestSeq})`,
      );

      const result = await this._syncService.downloadRemoteOps(syncCapableProvider);

      SyncLog.log(
        `WsTriggeredDownloadService: Download complete. newOps=${result.newOpsCount}`,
      );

      // Mark as in-sync after successful WS-triggered download
      if (result.newOpsCount >= 0 && !result.serverMigrationHandled) {
        this._providerManager.setSyncStatus('IN_SYNC');
      }
    } catch (err) {
      if (err instanceof AuthFailSPError || err instanceof MissingCredentialsSPError) {
        SyncLog.warn('WsTriggeredDownloadService: Auth failure during download', err);
        this.stop();
        return;
      }
      SyncLog.warn(
        'WsTriggeredDownloadService: Download failed, periodic sync will retry',
        err,
      );
    }
  }
}
