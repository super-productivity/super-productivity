import { SyncProviderPluginDefinition } from '@super-productivity/plugin-api';
import {
  FileSyncProvider,
  FileRevResponse,
  FileDownloadResponse,
} from '../../op-log/sync-providers/provider.interface';
import { SyncCredentialStore } from '../../op-log/sync-providers/credential-store.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { PrivateCfgByProviderId } from '../../op-log/core/types/sync.types';

/**
 * Adapts a plugin's SyncProviderPluginDefinition to the app's FileSyncProvider interface.
 * The plugin manages its own credentials via persistDataLocal, so privateCfg is a no-op store.
 */
export class PluginSyncProviderAdapter implements FileSyncProvider<SyncProviderId> {
  readonly id: SyncProviderId;
  readonly maxConcurrentRequests: number;
  readonly isUploadForcePossible: boolean;
  readonly privateCfg: SyncCredentialStore<SyncProviderId>;

  constructor(
    public readonly pluginId: string,
    private _definition: SyncProviderPluginDefinition,
  ) {
    // Cast the plugin key to SyncProviderId — validated by isPluginSyncProviderId()
    this.id = `plugin:${pluginId}` as unknown as SyncProviderId;
    this.maxConcurrentRequests = _definition.maxConcurrentRequests ?? 5;
    this.isUploadForcePossible = _definition.isUploadForcePossible ?? false;

    // Create a no-op credential store — plugin manages its own creds
    this.privateCfg = new NoOpCredentialStore(this.id);
  }

  async isReady(): Promise<boolean> {
    return this._definition.isReady();
  }

  async getFileRev(
    targetPath: string,
    localRev: string | null,
  ): Promise<FileRevResponse> {
    return this._definition.getFileRev(targetPath, localRev);
  }

  async downloadFile(targetPath: string): Promise<FileDownloadResponse> {
    return this._definition.downloadFile(targetPath);
  }

  async uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite?: boolean,
  ): Promise<FileRevResponse> {
    return this._definition.uploadFile(targetPath, dataStr, revToMatch, isForceOverwrite);
  }

  async removeFile(targetPath: string): Promise<void> {
    return this._definition.removeFile(targetPath);
  }

  async listFiles(targetPath: string): Promise<string[]> {
    if (this._definition.listFiles) {
      return this._definition.listFiles(targetPath);
    }
    return [];
  }

  async setPrivateCfg(): Promise<void> {
    // No-op — plugin manages its own credentials via persistDataLocal
  }
}

/**
 * No-op SyncCredentialStore for plugin-provided sync providers.
 * Plugin sync providers manage their own credentials via persistDataLocal/loadLocalData.
 */
class NoOpCredentialStore extends SyncCredentialStore<SyncProviderId> {
  constructor(providerId: SyncProviderId) {
    super(providerId);
  }

  override async load(): Promise<PrivateCfgByProviderId<SyncProviderId> | null> {
    // Return a minimal config so the adapter wrapper doesn't break
    return {} as PrivateCfgByProviderId<SyncProviderId>;
  }

  override async setComplete(): Promise<void> {
    // No-op
  }

  override async clear(): Promise<void> {
    // No-op
  }
}
