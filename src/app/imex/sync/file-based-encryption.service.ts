import { inject, Injectable } from '@angular/core';
import { SyncLog } from '../../core/log';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { isFileBasedProvider } from '../../op-log/sync/operation-sync.util';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import {
  CLIENT_ID_PROVIDER,
  ClientIdProvider,
} from '../../op-log/util/client-id.provider';
import { FileBasedSyncAdapterService } from '../../op-log/sync-providers/file-based/file-based-sync-adapter.service';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { uuidv7 } from '../../util/uuid-v7';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';

const LOG_PREFIX = 'FileBasedEncryptionService';

@Injectable({
  providedIn: 'root',
})
export class FileBasedEncryptionService {
  private _providerManager = inject(SyncProviderManager);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _vectorClockService = inject(VectorClockService);
  private _clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);
  private _fileBasedAdapter = inject(FileBasedSyncAdapterService);
  private _globalConfigService = inject(GlobalConfigService);
  private _wrappedProviderService = inject(WrappedProviderService);
  private _derivedKeyCache = inject(DerivedKeyCacheService);

  async enableEncryption(encryptKey: string): Promise<void> {
    await this._applyEncryption(encryptKey, 'enable');
  }

  async changePassword(newPassword: string): Promise<void> {
    await this._applyEncryption(newPassword, 'change');
  }

  private async _applyEncryption(
    encryptKey: string,
    action: 'enable' | 'change',
  ): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting ${action} for file-based provider...`);

    if (!encryptKey) {
      throw new Error('Encryption password is required');
    }

    const provider = this._providerManager.getActiveProvider();
    if (!provider) {
      throw new Error('No active sync provider. Please enable sync first.');
    }

    if (!isFileBasedProvider(provider)) {
      throw new Error(
        `This operation is only supported for file-based providers (Dropbox, WebDAV, LocalFile). ` +
          `Current provider: ${provider.id}`,
      );
    }

    if (!(await provider.isReady())) {
      throw new Error('Sync provider is not ready. Please configure sync first.');
    }

    const state = await this._stateSnapshotService.getStateSnapshotAsync();
    const vectorClock = await this._vectorClockService.getCurrentVectorClock();
    const clientId = await this._clientIdProvider.loadClientId();

    if (!clientId) {
      throw new Error('Client ID not available');
    }

    const existingCfg = await provider.privateCfg.load();

    const baseCfg = this._providerManager.getEncryptAndCompressCfg();
    const encryptedCfg = {
      ...baseCfg,
      isEncrypt: true,
    };

    const adapter = this._fileBasedAdapter.createAdapter(
      provider,
      encryptedCfg,
      encryptKey,
    );

    const result = await adapter.uploadSnapshot(
      state,
      clientId,
      'recovery',
      vectorClock,
      CURRENT_SCHEMA_VERSION,
      true,
      uuidv7(),
    );

    if (!result.accepted) {
      throw new Error(`Snapshot upload failed: ${result.error}`);
    }

    const newConfig = {
      ...existingCfg,
      encryptKey,
    };
    await this._providerManager.setProviderConfig(provider.id, newConfig);

    this._globalConfigService.updateSection('sync', {
      isEncryptionEnabled: true,
    });

    this._derivedKeyCache.clearCache();
    this._wrappedProviderService.clearCache();

    if (result.serverSeq !== undefined) {
      await adapter.setLastServerSeq(result.serverSeq);
    }

    SyncLog.normal(
      `${LOG_PREFIX}: Encryption ${action} for file-based provider complete.`,
    );
  }
}
