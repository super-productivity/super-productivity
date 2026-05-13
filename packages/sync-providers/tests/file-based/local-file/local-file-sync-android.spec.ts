import { describe, expect, it, vi } from 'vitest';
import { NOOP_SYNC_LOGGER } from '@sp/sync-core';
import {
  LocalFileSyncAndroid,
  type FileAdapter,
  type LocalFileSyncAndroidDeps,
  type LocalFileSyncPrivateCfg,
  PROVIDER_ID_LOCAL_FILE,
  type SyncCredentialStorePort,
} from '../../../src';

const fakeStore = (
  initial: LocalFileSyncPrivateCfg | null,
): SyncCredentialStorePort<typeof PROVIDER_ID_LOCAL_FILE, LocalFileSyncPrivateCfg> => {
  let state = initial;
  return {
    load: vi.fn(async () => state),
    setComplete: vi.fn(async (cfg) => {
      state = cfg;
    }),
    updatePartial: vi.fn(async (updates) => {
      state = { ...(state ?? {}), ...updates };
    }),
    upsertPartial: vi.fn(async (updates) => {
      state = { ...(state ?? {}), ...updates };
    }),
    clear: vi.fn(async () => {
      state = null;
    }),
  };
};

const noopFileAdapter: FileAdapter = {
  readFile: async () => '',
  writeFile: async () => undefined,
  deleteFile: async () => undefined,
};

const makeProvider = (
  store: SyncCredentialStorePort<typeof PROVIDER_ID_LOCAL_FILE, LocalFileSyncPrivateCfg>,
  overrides: Partial<LocalFileSyncAndroidDeps['saf']> = {},
): {
  provider: LocalFileSyncAndroid;
  selectFolder: ReturnType<typeof vi.fn<() => Promise<string>>>;
  checkPermission: ReturnType<typeof vi.fn<(uri?: string) => Promise<boolean>>>;
} => {
  const selectFolder = vi.fn<() => Promise<string>>().mockResolvedValue('content://uri');
  const checkPermission = vi
    .fn<(uri?: string) => Promise<boolean>>()
    .mockResolvedValue(true);
  const provider = new LocalFileSyncAndroid({
    logger: NOOP_SYNC_LOGGER,
    fileAdapter: noopFileAdapter,
    credentialStore: store,
    saf: {
      selectFolder,
      checkPermission,
      ...overrides,
    },
  });
  return { provider, selectFolder, checkPermission };
};

describe('LocalFileSyncAndroid', () => {
  it('is ready when SAF URI exists and permission is still granted', async () => {
    const store = fakeStore({ safFolderUri: 'content://uri' });
    const { provider, checkPermission } = makeProvider(store);

    await expect(provider.isReady()).resolves.toBe(true);
    expect(checkPermission).toHaveBeenCalledWith('content://uri');
  });

  it('clears stale SAF URI when permission was revoked', async () => {
    const store = fakeStore({ safFolderUri: 'content://uri' });
    const { provider } = makeProvider(store, {
      checkPermission: vi
        .fn<(uri?: string) => Promise<boolean>>()
        .mockResolvedValue(false),
    });

    await expect(provider.isReady()).resolves.toBe(false);
    expect(await store.load()).toEqual({ safFolderUri: undefined });
  });

  it('setupSaf stores selected URI', async () => {
    const store = fakeStore(null);
    const { provider, selectFolder } = makeProvider(store);

    await expect(provider.setupSaf()).resolves.toBe('content://uri');
    expect(selectFolder).toHaveBeenCalledTimes(1);
    expect(await store.load()).toEqual({ safFolderUri: 'content://uri' });
  });

  it('uses targetPath directly as file adapter path', async () => {
    const store = fakeStore(null);
    const { provider } = makeProvider(store);

    await expect(provider.getFilePath('/sync-data.json')).resolves.toBe(
      '/sync-data.json',
    );
  });
});
