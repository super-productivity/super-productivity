import { describe, expect, it, vi } from 'vitest';
import { NOOP_SYNC_LOGGER } from '@sp/sync-core';
import {
  LocalFileSyncElectron,
  type LocalFileSyncElectronDeps,
  type LocalFileSyncPrivateCfg,
  PROVIDER_ID_LOCAL_FILE,
} from '../../../src/local-file';
import type { FileAdapter } from '../../../src/file-based';
import type { SyncCredentialStorePort } from '../../../src/credential-store';

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
  listFiles: async () => [],
};

const makeProvider = (
  overrides: Partial<LocalFileSyncElectronDeps> = {},
): {
  provider: LocalFileSyncElectron;
  store: SyncCredentialStorePort<typeof PROVIDER_ID_LOCAL_FILE, LocalFileSyncPrivateCfg>;
  pickDirectory: ReturnType<typeof vi.fn<() => Promise<string | void>>>;
  checkDirExists: ReturnType<typeof vi.fn<(dirPath: string) => Promise<boolean>>>;
} => {
  const store = fakeStore(null);
  const pickDirectory = vi
    .fn<() => Promise<string | void>>()
    .mockResolvedValue('/picked/dir');
  const checkDirExists = vi
    .fn<(dirPath: string) => Promise<boolean>>()
    .mockResolvedValue(true);
  const deps: LocalFileSyncElectronDeps = {
    logger: NOOP_SYNC_LOGGER,
    fileAdapter: noopFileAdapter,
    credentialStore: store,
    isElectron: true,
    pickDirectory,
    checkDirExists,
    ...overrides,
  };
  return {
    provider: new LocalFileSyncElectron(deps),
    store,
    pickDirectory: deps.pickDirectory as ReturnType<
      typeof vi.fn<() => Promise<string | void>>
    >,
    checkDirExists: deps.checkDirExists as ReturnType<
      typeof vi.fn<(dirPath: string) => Promise<boolean>>
    >,
  };
};

describe('LocalFileSyncElectron', () => {
  it('reports ready only on Electron with configured folder path', async () => {
    const ready = makeProvider({ credentialStore: fakeStore({ syncFolderPath: '/x' }) });
    await expect(ready.provider.isReady()).resolves.toBe(true);

    const missingPath = makeProvider({ credentialStore: fakeStore(null) });
    await expect(missingPath.provider.isReady()).resolves.toBe(false);

    const notElectron = makeProvider({ isElectron: false });
    await expect(notElectron.provider.isReady()).rejects.toThrow(
      'LocalFileSyncElectron is only available in electron',
    );
  });

  it('normalizes target paths under the configured folder path', async () => {
    const { provider } = makeProvider({
      credentialStore: fakeStore({ syncFolderPath: '/my/sync' }),
    });

    await expect(provider.getFilePath('/data.json')).resolves.toBe('/my/sync/data.json');
  });

  it('opens the picker once when no folder is configured', async () => {
    const store = fakeStore(null);
    const { provider, pickDirectory } = makeProvider({ credentialStore: store });

    await expect(provider.getFilePath('data.json')).resolves.toBe(
      '/picked/dir/data.json',
    );
    expect(pickDirectory).toHaveBeenCalledTimes(1);
    expect(await store.load()).toEqual({ syncFolderPath: '/picked/dir' });
  });

  it('throws when picker is cancelled and avoids recursive retries', async () => {
    const { provider, pickDirectory, store } = makeProvider({
      pickDirectory: vi.fn<() => Promise<string | void>>().mockResolvedValue(undefined),
    });

    await expect(provider.getFilePath('data.json')).rejects.toThrow(
      'No sync folder path configured after directory picker',
    );

    expect(pickDirectory).toHaveBeenCalledTimes(1);
    expect(store.load).toHaveBeenCalledTimes(3);
  });
});
