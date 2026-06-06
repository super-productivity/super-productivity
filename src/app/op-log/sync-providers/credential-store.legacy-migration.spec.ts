import { openDB } from 'idb';
import { SyncCredentialStore } from './credential-store.service';
import { SyncProviderId, PRIVATE_CFG_PREFIX } from './provider.const';

/**
 * Regression coverage for the legacy WebDAV credential migration (context:
 * issue #7616). This path previously had zero tests.
 *
 * The pre-rework PFAPI stored the WebDAV private config as a raw flat
 * object at: database `pf`, store `main`, key `__sp_cred_WebDAV`
 * (`PRIVATE_CFG_PREFIX + 'WebDAV'`). `SyncCredentialStore.load()` migrates
 * it into the new `sup-sync`/`credentials` store on first access. This
 * harness seeds the legacy record as the old code wrote it and asserts the
 * credentials (including `encryptKey`) survive the upgrade.
 */

const LEGACY_DB = 'pf';
const LEGACY_STORE = 'main';
const NEW_DB = 'sup-sync';
const NEW_STORE = 'credentials';
const WEBDAV_KEY = PRIVATE_CFG_PREFIX + SyncProviderId.WebDAV; // '__sp_cred_WebDAV'

// Faithful old WebdavPrivateCfg shape (flat object, encryptKey inline).
interface LegacyWebdavCfg {
  baseUrl: string;
  userName: string;
  password: string;
  syncFolderPath: string;
  encryptKey?: string;
}

const makeLegacyWebdavCfg = (suffix: string): LegacyWebdavCfg => ({
  baseUrl: `https://nextcloud.example.test/remote.php/dav/${suffix}`,
  userName: `user-${suffix}`,
  password: `pw-${suffix}`,
  syncFolderPath: `/sp-sync-${suffix}`,
  encryptKey: `enc-key-${suffix}`,
});

/**
 * Open the legacy `pf` db at its canonical version 1 with the `main`
 * store — the exact shape `legacy-pf-db.service` / `client-id.service`
 * use. Never bump the version: `pf` is shared across the whole Karma
 * session and those services open it at hardcoded version 1, so escalating
 * it here would throw VersionError in unrelated specs (order-dependent
 * flake). Production `_migrateFromLegacyDb` opens `pf` version-less, so a
 * fixed version 1 here is fully compatible.
 */
const openLegacy = async (): Promise<Awaited<ReturnType<typeof openDB>>> =>
  openDB(LEGACY_DB, 1, {
    upgrade: (d) => {
      if (!d.objectStoreNames.contains(LEGACY_STORE)) {
        d.createObjectStore(LEGACY_STORE);
      }
    },
  });

/**
 * The new `sup-sync` db is owned by SyncCredentialStore at a HARDCODED
 * version 1 with a `credentials` store. The harness must open it with the
 * exact same schema/version — never bump it — or the service's
 * `openDB('sup-sync', 1)` throws VersionError.
 */
const openNew = async (): Promise<Awaited<ReturnType<typeof openDB>>> =>
  openDB(NEW_DB, 1, {
    upgrade: (d) => {
      if (!d.objectStoreNames.contains(NEW_STORE)) {
        d.createObjectStore(NEW_STORE);
      }
    },
  });

const seedLegacyWebdav = async (cfg: LegacyWebdavCfg): Promise<void> => {
  const db = await openLegacy();
  // Exactly how the old IndexedDbAdapter.save wrote it: put(store, data, key)
  await db.put(LEGACY_STORE, cfg, WEBDAV_KEY);
  db.close();
};

const clearLegacyWebdav = async (): Promise<void> => {
  const db = await openLegacy();
  await db.delete(LEGACY_STORE, WEBDAV_KEY);
  db.close();
};

const clearNewWebdav = async (): Promise<void> => {
  const db = await openNew();
  await db.delete(NEW_STORE, WEBDAV_KEY);
  db.close();
};

const readNewWebdav = async (): Promise<unknown> => {
  const db = await openNew();
  const v = await db.get(NEW_STORE, WEBDAV_KEY);
  db.close();
  return v;
};

describe('SyncCredentialStore legacy WebDAV migration (issue #7616)', () => {
  beforeEach(async () => {
    // Deterministic clean slate: no new-db entry, no legacy entry.
    await clearNewWebdav();
    await clearLegacyWebdav();
  });

  it('migrates legacy WebDAV credentials so a passive upgrade keeps the connection', async () => {
    const cfg = makeLegacyWebdavCfg('survive');
    await seedLegacyWebdav(cfg);

    const store = new SyncCredentialStore(SyncProviderId.WebDAV);
    const loaded = await store.load();

    expect(loaded)
      .withContext('legacy WebDAV cfg must survive the upgrade, not vanish')
      .toEqual(cfg as unknown as typeof loaded);
  });

  it('preserves encryptKey through migration (encryption must not silently disable)', async () => {
    const cfg = makeLegacyWebdavCfg('enckey');
    await seedLegacyWebdav(cfg);

    const loaded = (await new SyncCredentialStore(
      SyncProviderId.WebDAV,
    ).load()) as unknown as LegacyWebdavCfg | null;

    expect(loaded?.encryptKey)
      .withContext('dropped encryptKey -> DecryptNoPasswordError -> destructive recovery')
      .toBe(cfg.encryptKey);
  });

  it('persists the migrated cfg into the new db (survives a second instance)', async () => {
    const cfg = makeLegacyWebdavCfg('persist');
    await seedLegacyWebdav(cfg);

    await new SyncCredentialStore(SyncProviderId.WebDAV).load();

    expect(await readNewWebdav())
      .withContext('migration must write through to sup-sync/credentials')
      .toEqual(cfg);
    const fresh = await new SyncCredentialStore(SyncProviderId.WebDAV).load();
    expect(fresh).toEqual(cfg as unknown as typeof fresh);
  });

  it('returns null without throwing when no legacy WebDAV key is present', async () => {
    const store = new SyncCredentialStore(SyncProviderId.WebDAV);
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });
});
