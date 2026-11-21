import { CURRENT_SCHEMA_VERSION } from '../op-log/persistence/schema-migration.service';
import { RemoteFileNotFoundAPIError } from '../op-log/core/errors/sync-errors';
import { EncryptAndCompressHandlerService } from '../op-log/encryption/encrypt-and-compress-handler.service';
import { SyncProviderId } from '../op-log/sync-providers/provider.const';
import { SyncProviderManager } from '../op-log/sync-providers/provider-manager.service';
import { FileSyncProvider } from '../op-log/sync-providers/provider.interface';
import { FILE_BASED_SYNC_CONSTANTS } from '../op-log/sync-providers/file-based/file-based-sync.types';
import { readPublishedPluginSnapshot } from './plugin-published-snapshot-reader';

describe('published plugin snapshot transport', () => {
  let provider: FileSyncProvider<SyncProviderId>;
  let manager: Pick<
    SyncProviderManager,
    'getActiveProvider' | 'getEncryptAndCompressCfg' | 'configEpoch' | 'syncEpoch'
  >;
  let download: jasmine.Spy;
  let revision: jasmine.Spy;
  let configEpoch: number;
  let syncEpoch: number;
  let cfg: { baseUrl: string; encryptKey?: string; isEncryptionEnabled?: boolean };
  let loadCfg: jasmine.Spy;
  let raw: Record<string, unknown>;
  let dataStr: string;
  const handler = new EncryptAndCompressHandlerService();
  const encode = async (isCompress = false, isEncrypt = false): Promise<void> => {
    dataStr = await handler.compressAndEncryptData(
      { isCompress, isEncrypt },
      cfg.encryptKey,
      raw,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );
  };

  beforeEach(async () => {
    configEpoch = 1;
    syncEpoch = 2;
    cfg = { baseUrl: 'https://fixture.invalid/dav' };
    loadCfg = jasmine.createSpy('loadCfg').and.callFake(async () => cfg);
    raw = {
      taskArchiveSnapshotVersion: 1,
      version: 2,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      syncVersion: 12,
      vectorClock: { fixture: 12 },
      lastModified: 1234,
      clientId: 'fixture',
      recentOps: [],
      state: {
        task: { ids: ['t1'], entities: { t1: { id: 't1', isDone: false } } },
        pluginUserData: [
          { id: 'attachments:intent/1', data: '{"taskId":"t1"}' },
          { id: 'other:secret', data: 'not returned' },
        ],
      },
      archiveYoung: { task: { ids: [], entities: {} }, timeTracking: {} },
      archiveOld: { task: { ids: [], entities: {} }, timeTracking: {} },
    };
    await encode();
    download = jasmine.createSpy('download').and.callFake(async () => ({
      rev: 'r1',
      dataStr,
    }));
    revision = jasmine.createSpy('revision').and.callFake(async (path: string) => {
      if (path === 'sync-ops.json') throw new RemoteFileNotFoundAPIError('fixture');
      return { rev: 'r1' };
    });
    provider = {
      id: SyncProviderId.WebDAV,
      privateCfg: { load: loadCfg },
      downloadFile: download,
      getFileRev: revision,
      uploadFile: jasmine.createSpy('upload'),
      removeFile: jasmine.createSpy('remove'),
      setPrivateCfg: jasmine.createSpy('setCfg'),
    } as unknown as FileSyncProvider<SyncProviderId>;
    manager = {
      getActiveProvider: () => provider,
      getEncryptAndCompressCfg: () => ({ isCompress: false, isEncrypt: false }),
      get configEpoch() {
        return configEpoch;
      },
      get syncEpoch() {
        return syncEpoch;
      },
    };
  });

  it('reads only the primary and returns task IDs and the caller namespace', async () => {
    const result = await readPublishedPluginSnapshot(manager, 'attachments');
    expect(result.tasks).toEqual([{ id: 't1', location: 'active', isDone: false }]);
    expect(result.pluginData).toEqual([{ key: 'intent/1', value: '{"taskId":"t1"}' }]);
    expect(result.clock).toEqual({ fixture: 12 });
    expect(download).toHaveBeenCalledOnceWith('sync-data.json');
    expect(revision.calls.allArgs()).toEqual([
      ['sync-ops.json', null],
      ['sync-data.json', null],
      ['sync-ops.json', null],
    ]);
    expect(provider.uploadFile).not.toHaveBeenCalled();
    expect(provider.removeFile).not.toHaveBeenCalled();
    expect(provider.setPrivateCfg).not.toHaveBeenCalled();
  });

  it('uses the existing compressed encrypted decoder with provider encryption intent', async () => {
    cfg.encryptKey = 'fixture-password';
    cfg.isEncryptionEnabled = true;
    await encode(true, true);
    expect((await readPublishedPluginSnapshot(manager, 'attachments')).tasks.length).toBe(
      1,
    );
  });

  it('refuses plaintext when per-provider encryption is required despite a stale global flag', async () => {
    cfg.encryptKey = 'fixture-password';
    cfg.isEncryptionEnabled = true;
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
  });

  it('does not read a backup when the primary is corrupt or missing', async () => {
    dataStr = 'invalid primary';
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
    download.and.rejectWith(new RemoteFileNotFoundAPIError('fixture'));
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
    expect(download.calls.allArgs()).toEqual([['sync-data.json'], ['sync-data.json']]);
  });

  it('refuses an existing split head before downloading a stale v2 file', async () => {
    revision.and.resolveTo({ rev: 'split' });
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
    expect(download).not.toHaveBeenCalled();
  });

  it('does not mistake a failed split probe for a 404', async () => {
    revision.and.rejectWith(new Error('fixture network failure'));
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses migration that commits a split head during the primary read', async () => {
    let probes = 0;
    revision.and.callFake(async (path: string) => {
      if (path === 'sync-ops.json' && ++probes === 1) {
        throw new RemoteFileNotFoundAPIError('fixture');
      }
      return { rev: path === 'sync-ops.json' ? 'split' : 'r1' };
    });
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
  });

  it('refuses a primary replaced during decoding', async () => {
    revision.and.callFake(async (path: string) => {
      if (path === 'sync-ops.json') throw new RemoteFileNotFoundAPIError('fixture');
      return { rev: 'r2' };
    });
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
  });

  for (const mutation of [
    'config',
    'sync',
    'target',
    'key',
    'provider',
    'compression',
    'encryption',
    'encryption-intent',
  ] as const) {
    it(`refuses a ${mutation} change during the primary read`, async () => {
      download.and.callFake(async () => {
        if (mutation === 'config') configEpoch++;
        if (mutation === 'sync') syncEpoch++;
        if (mutation === 'target') cfg.baseUrl = 'https://other.invalid/dav';
        if (mutation === 'key') cfg.encryptKey = 'new-key';
        if (mutation === 'provider') manager.getActiveProvider = () => null;
        if (mutation === 'compression') {
          manager.getEncryptAndCompressCfg = () => ({
            isCompress: true,
            isEncrypt: false,
          });
        }
        if (mutation === 'encryption') {
          manager.getEncryptAndCompressCfg = () => ({
            isCompress: false,
            isEncrypt: true,
          });
        }
        if (mutation === 'encryption-intent') cfg.isEncryptionEnabled = true;
        return { rev: 'r1', dataStr };
      });
      await expectAsync(
        readPublishedPluginSnapshot(manager, 'attachments'),
      ).toBeRejected();
    });
  }

  it('refuses an incomplete archive rather than treating it as empty', async () => {
    delete raw.archiveOld;
    await encode();
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
  });

  it('does not expose remote error contents to a plugin boundary', async () => {
    download.and.rejectWith(new Error('fixture-sensitive-value'));
    await expectAsync(
      readPublishedPluginSnapshot(manager, 'attachments'),
    ).toBeRejectedWithError('Published snapshot could not be verified');
  });

  it('does not expose an initial credential-store error', async () => {
    loadCfg.and.rejectWith(new Error('fixture-sensitive-credential'));
    await expectAsync(
      readPublishedPluginSnapshot(manager, 'attachments'),
    ).toBeRejectedWithError('Published snapshot could not be verified');
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses single-file providers which cannot probe for split migration', async () => {
    provider.isLimitedToSingleFileSync = true;
    await expectAsync(readPublishedPluginSnapshot(manager, 'attachments')).toBeRejected();
    expect(download).not.toHaveBeenCalled();
  });
});
