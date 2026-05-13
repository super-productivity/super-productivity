import { describe, expect, it, vi } from 'vitest';
import {
  FILE_BASED_SYNC_CONSTANTS,
  type FileBasedSyncData,
  type SyncFileCompactOp,
} from '../src/file-based';
import {
  isFileSyncProvider,
  type FileSyncProvider,
  type OperationSyncCapable,
  type SyncProviderBase,
} from '../src/provider-types';
import type { SyncCredentialStorePort } from '../src/credential-store';

type ProviderId = 'file' | 'ops';
interface ProviderPrivateCfg {
  token?: string;
}
interface HostCompactOp {
  id: string;
  action: string;
}
interface HostArchive {
  records: number;
}

const createCredentialStore = (): SyncCredentialStorePort<
  ProviderId,
  ProviderPrivateCfg
> => ({
  load: vi.fn().mockResolvedValue({ token: 'test-token' }),
  setComplete: vi.fn().mockResolvedValue(undefined),
  updatePartial: vi.fn().mockResolvedValue(undefined),
  upsertPartial: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
});

describe('sync provider contracts', () => {
  it('keeps provider IDs and private config host-owned', async () => {
    const provider: SyncProviderBase<ProviderId, ProviderPrivateCfg> = {
      id: 'ops',
      maxConcurrentRequests: 4,
      privateCfg: createCredentialStore(),
      isReady: vi.fn().mockResolvedValue(true),
      setPrivateCfg: vi.fn().mockResolvedValue(undefined),
    };

    await expect(provider.privateCfg.load()).resolves.toEqual({
      token: 'test-token',
    });
    expect(provider.id).toBe('ops');
  });

  it('identifies file sync providers by file operation capability', () => {
    const fileProvider: FileSyncProvider<ProviderId, ProviderPrivateCfg> = {
      id: 'file',
      maxConcurrentRequests: 2,
      privateCfg: createCredentialStore(),
      isReady: vi.fn().mockResolvedValue(true),
      setPrivateCfg: vi.fn().mockResolvedValue(undefined),
      getFileRev: vi.fn().mockResolvedValue({ rev: '1' }),
      downloadFile: vi.fn().mockResolvedValue({ rev: '1', dataStr: '{}' }),
      uploadFile: vi.fn().mockResolvedValue({ rev: '2' }),
      removeFile: vi.fn().mockResolvedValue(undefined),
    };
    const opsProvider: SyncProviderBase<ProviderId, ProviderPrivateCfg> = {
      id: 'ops',
      maxConcurrentRequests: 4,
      privateCfg: createCredentialStore(),
      isReady: vi.fn().mockResolvedValue(true),
      setPrivateCfg: vi.fn().mockResolvedValue(undefined),
    };

    expect(isFileSyncProvider(fileProvider)).toBe(true);
    expect(isFileSyncProvider(opsProvider)).toBe(false);
  });

  it('keeps restore point strings supplied by the host app', async () => {
    type RestorePointType = 'SYNC_IMPORT' | 'CUSTOM_REPAIR';
    const provider: OperationSyncCapable<'superSyncOps', RestorePointType> = {
      supportsOperationSync: true,
      providerMode: 'superSyncOps',
      uploadOps: vi.fn().mockResolvedValue({ results: [], latestSeq: 1 }),
      downloadOps: vi.fn().mockResolvedValue({ ops: [], hasMore: false, latestSeq: 1 }),
      getLastServerSeq: vi.fn().mockResolvedValue(1),
      setLastServerSeq: vi.fn().mockResolvedValue(undefined),
      uploadSnapshot: vi.fn().mockResolvedValue({ accepted: true, serverSeq: 2 }),
      deleteAllData: vi.fn().mockResolvedValue({ success: true }),
    };

    await expect(
      provider.uploadSnapshot(
        {},
        'client-a',
        'recovery',
        { clientA: 1 },
        1,
        false,
        'op-a',
        false,
        'CUSTOM_REPAIR',
      ),
    ).resolves.toEqual({ accepted: true, serverSeq: 2 });
  });

  it('keeps file-based sync data host payloads generic', () => {
    const recentOp: SyncFileCompactOp<HostCompactOp> = {
      id: 'op-a',
      action: 'create',
      sv: 7,
    };
    const data: FileBasedSyncData<{ entities: string[] }, HostCompactOp, HostArchive> = {
      version: FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      syncVersion: 8,
      schemaVersion: 1,
      vectorClock: { clientA: 3 },
      lastModified: 1701700000000,
      clientId: 'client-a',
      state: { entities: ['a'] },
      archiveYoung: { records: 1 },
      archiveOld: { records: 2 },
      recentOps: [recentOp],
      oldestOpSyncVersion: 7,
    };

    expect(data.recentOps[0].sv).toBe(7);
    expect(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE).toBe('sync-data.json');
  });
});
