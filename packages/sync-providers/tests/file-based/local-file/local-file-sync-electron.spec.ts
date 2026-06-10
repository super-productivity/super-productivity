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
import { createStatefulCredentialStore } from '../../helpers/credential-store';

const fakeStore = (
  initial: LocalFileSyncPrivateCfg | null,
): SyncCredentialStorePort<typeof PROVIDER_ID_LOCAL_FILE, LocalFileSyncPrivateCfg> =>
  createStatefulCredentialStore<typeof PROVIDER_ID_LOCAL_FILE, LocalFileSyncPrivateCfg>(
    initial,
  );

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
  getMainSyncFolderPath: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
} => {
  const store = fakeStore(null);
  const pickDirectory = vi
    .fn<() => Promise<string | void>>()
    .mockResolvedValue('/picked/dir');
  const getMainSyncFolderPath = vi
    .fn<() => Promise<string | null>>()
    .mockResolvedValue(null);
  const deps: LocalFileSyncElectronDeps = {
    logger: NOOP_SYNC_LOGGER,
    fileAdapter: noopFileAdapter,
    credentialStore: store,
    isElectron: true,
    pickDirectory,
    getMainSyncFolderPath,
    ...overrides,
  };
  return {
    provider: new LocalFileSyncElectron(deps),
    store,
    pickDirectory: deps.pickDirectory as ReturnType<
      typeof vi.fn<() => Promise<string | void>>
    >,
    getMainSyncFolderPath: deps.getMainSyncFolderPath as ReturnType<
      typeof vi.fn<() => Promise<string | null>>
    >,
  };
};

describe('LocalFileSyncElectron', () => {
  it('reports ready based on main-side sync folder, not renderer privateCfg', async () => {
    const ready = makeProvider({
      // privateCfg still has the legacy value but isReady ignores it —
      // main is the source of truth post-#8228.
      credentialStore: fakeStore({ syncFolderPath: '/legacy/path' }),
      getMainSyncFolderPath: vi
        .fn<() => Promise<string | null>>()
        .mockResolvedValue('/main/path'),
    });
    await expect(ready.provider.isReady()).resolves.toBe(true);

    const noMain = makeProvider({
      // Renderer thinks it's configured (legacy) but main has nothing →
      // user must re-pick (acceptable migration UX).
      credentialStore: fakeStore({ syncFolderPath: '/legacy/path' }),
      getMainSyncFolderPath: vi
        .fn<() => Promise<string | null>>()
        .mockResolvedValue(null),
    });
    await expect(noMain.provider.isReady()).resolves.toBe(false);

    const notElectron = makeProvider({ isElectron: false });
    await expect(notElectron.provider.isReady()).rejects.toThrow(
      'LocalFileSyncElectron is only available in electron',
    );
  });

  it('returns the relative path for FS adapters; main resolves against its own root', async () => {
    const { provider } = makeProvider();

    // Leading slash is stripped so '/data.json' and 'data.json' are
    // equivalent — preserves the existing call-site convention.
    await expect(provider.getFilePath('/data.json')).resolves.toBe('data.json');
    await expect(provider.getFilePath('data.json')).resolves.toBe('data.json');
    await expect(provider.getFilePath('sub/x.json')).resolves.toBe('sub/x.json');
  });

  it('pickDirectory delegates to deps without writing to renderer privateCfg', async () => {
    const store = fakeStore(null);
    const setComplete = vi.spyOn(store, 'setComplete');
    const upsertPartial = vi.spyOn(
      store as unknown as { upsertPartial: typeof store.setComplete },
      'upsertPartial' as never,
    );
    const { provider, pickDirectory } = makeProvider({ credentialStore: store });

    await expect(provider.pickDirectory()).resolves.toBe('/picked/dir');
    expect(pickDirectory).toHaveBeenCalledTimes(1);
    // Main owns persistence now — the package must not write the picked
    // path into the renderer credential store, where a compromised
    // renderer could rewrite it.
    expect(setComplete).not.toHaveBeenCalled();
    expect(upsertPartial).not.toHaveBeenCalled();
  });

  it('pickDirectory propagates picker errors', async () => {
    const { provider } = makeProvider({
      pickDirectory: vi
        .fn<() => Promise<string | void>>()
        .mockRejectedValue(new Error('user cancelled')),
    });
    await expect(provider.pickDirectory()).rejects.toThrow('user cancelled');
  });
});
