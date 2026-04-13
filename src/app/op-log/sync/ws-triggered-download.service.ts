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
 * Pipeline: newOpsNotification$ → debounce(500ms) → filter(!syncInProgress) → exhaustMap(download)
 *
 * Uses exhaustMap to ignore new notifications while a download is in progress.
 * Reuses the existing OperationLogSyncService.downloadRemoteOps() code path.
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
        debounceTime(WS_DOWNLOAD_DEBOUNCE_MS),
        filter(() => !(globalThis as any).__SP_E2E_BLOCK_WS_DOWNLOAD),
        filter(() => !this._providerManager.isSyncInProgress),
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
    if (this._providerManager.isSyncInProgress) {
      SyncLog.log('WsTriggeredDownloadService: Sync in progress, skipping WS download');
      return;
    }

    try {
      const rawProvider = this._providerManager.getActiveProvider();
      if (!rawProvider) {
        SyncLog.log(
          'WsTriggeredDownloadService: No active provider, skipping WS download',
        );
        return;
      }

      const syncCapableProvider =
        await this._wrappedProvider.getOperationSyncCapable(rawProvider);
      if (!syncCapableProvider) {
        SyncLog.log(
          'WsTriggeredDownloadService: Provider not operation-sync capable, skipping',
        );
        return;
      }

      SyncLog.log(
        `WsTriggeredDownloadService: Downloading ops triggered by WS notification (latestSeq=${latestSeq})`,
      );

      const result = await this._syncService.downloadRemoteOps(syncCapableProvider);

      SyncLog.log(`WsTriggeredDownloadService: Download complete. kind=${result.kind}`);
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
