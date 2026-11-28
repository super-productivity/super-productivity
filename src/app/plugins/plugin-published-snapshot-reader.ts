import { RemoteFileNotFoundAPIError } from '../op-log/core/errors/sync-errors';
import { EncryptAndCompressHandlerService } from '../op-log/encryption/encrypt-and-compress-handler.service';
import { FILE_BASED_SYNC_CONSTANTS } from '../op-log/sync-providers/file-based/file-based-sync.types';
import { isFileSyncProvider } from '../op-log/sync-providers/provider.interface';
import { SyncProviderManager } from '../op-log/sync-providers/provider-manager.service';
import { isSyncTargetChanged } from '../op-log/sync-providers/sync-target-identity.util';
import {
  projectPublishedPluginSnapshot,
  PublishedPluginSnapshot,
} from './plugin-published-snapshot';

type SnapshotProviderManager = Pick<
  SyncProviderManager,
  'getActiveProvider' | 'getEncryptAndCompressCfg' | 'configEpoch' | 'syncEpoch'
>;

/**
 * Reads a published v2 primary without applying operations, repairing files,
 * reading backups, or acknowledging local writes. This is a point-in-time
 * observation, NOT a lease or permission to delete an attachment.
 * Exposed through the bound readPublishedSnapshot API; ownership remains the
 * caller's responsibility.
 */
export const readPublishedPluginSnapshot = async (
  manager: SnapshotProviderManager,
  pluginId: string,
): Promise<PublishedPluginSnapshot> => {
  const provider = manager.getActiveProvider();
  if (!provider || !isFileSyncProvider(provider) || provider.isLimitedToSingleFileSync) {
    throw new Error('Published snapshot requires a multi-file sync provider');
  }
  const configEpoch = manager.configEpoch;
  const syncEpoch = manager.syncEpoch;
  const baseCfg = { ...manager.getEncryptAndCompressCfg() };
  try {
    const loadedCfg = await provider.privateCfg.load();
    if (!loadedCfg) throw new Error('Published snapshot configuration is unavailable');
    // Credential stores may return a live object. Keep a private copy, never log it.
    const privateCfg = structuredClone(loadedCfg);
    const encryptKey = privateCfg.encryptKey;
    const isEncrypt = privateCfg.isEncryptionEnabled ?? !!encryptKey;
    const assertCurrent = async (): Promise<void> => {
      const fresh = await provider.privateCfg.load();
      const cfg = manager.getEncryptAndCompressCfg();
      if (
        manager.getActiveProvider() !== provider ||
        manager.configEpoch !== configEpoch ||
        manager.syncEpoch !== syncEpoch ||
        cfg.isEncrypt !== baseCfg.isEncrypt ||
        cfg.isCompress !== baseCfg.isCompress ||
        !fresh ||
        isSyncTargetChanged(privateCfg, fresh) ||
        fresh.encryptKey !== encryptKey ||
        (fresh.isEncryptionEnabled ?? !!fresh.encryptKey) !== isEncrypt
      ) {
        throw new Error('Published snapshot configuration changed');
      }
    };
    const assertNoSplitHead = async (): Promise<void> => {
      await assertCurrent();
      try {
        await provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.OPS_FILE, null);
      } catch (error) {
        // A timeout, 401, invalid response, or network error does NOT prove absence.
        if (!(error instanceof RemoteFileNotFoundAPIError)) throw error;
        return;
      }
      throw new Error('Published split snapshots are not supported');
    };

    await assertNoSplitHead();
    await assertCurrent();
    const response = await provider.downloadFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
    await assertCurrent();
    const handler = new EncryptAndCompressHandlerService();
    const raw = await handler.decompressAndDecryptData<unknown>(
      { ...baseCfg, isEncrypt },
      encryptKey,
      response.dataStr,
    );
    const snapshot = await projectPublishedPluginSnapshot(raw, pluginId, response.rev);
    await assertCurrent();
    const revision = await provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE, null);
    if (revision.rev !== response.rev) throw new Error('Published snapshot changed');
    await assertNoSplitHead();
    await assertCurrent();
    return snapshot;
  } catch {
    // Provider/decoder errors can carry request credentials or remote contents.
    throw new Error('Published snapshot could not be verified');
  }
};
