import { TestBed } from '@angular/core/testing';
import { openDB } from 'idb';
import { ClientIdService } from './client-id.service';
import {
  DB_NAME,
  DB_VERSION,
  SINGLETON_KEY,
  STORE_NAMES,
} from '../../op-log/persistence/db-keys.const';
import { runDbUpgrade } from '../../op-log/persistence/db-upgrade';

// --- raw IndexedDB helpers (bypass ClientIdService to set up / inspect state) ---

const openSupOps = (): ReturnType<typeof openDB> =>
  openDB(DB_NAME, DB_VERSION, {
    upgrade: (db, oldVersion, _newVersion, tx) => runDbUpgrade(db, oldVersion, tx),
  });

const seedSupOps = async (value: unknown): Promise<void> => {
  const db = await openSupOps();
  await db.put(STORE_NAMES.CLIENT_ID, value, SINGLETON_KEY);
  db.close();
};

const readSupOps = async (): Promise<unknown> => {
  const db = await openSupOps();
  const value = await db.get(STORE_NAMES.CLIENT_ID, SINGLETON_KEY);
  db.close();
  return value;
};

const clearSupOps = async (): Promise<void> => {
  const db = await openSupOps();
  await db.clear(STORE_NAMES.CLIENT_ID);
  db.close();
};

const PF_DB_NAME = 'pf';
const PF_STORE = 'main';
const PF_CLIENT_ID_KEY = '__client_id_';
const PF_LEGACY_CLIENT_ID_KEY = 'CLIENT_ID';

const openPf = (): ReturnType<typeof openDB> =>
  openDB(PF_DB_NAME, 1, {
    upgrade: (db) => {
      if (!db.objectStoreNames.contains(PF_STORE)) {
        db.createObjectStore(PF_STORE);
      }
    },
  });

const seedPf = async (key: string, value: unknown): Promise<void> => {
  const db = await openPf();
  await db.put(PF_STORE, value, key);
  db.close();
};

const clearPf = async (): Promise<void> => {
  const db = await openPf();
  await db.delete(PF_STORE, PF_CLIENT_ID_KEY);
  await db.delete(PF_STORE, PF_LEGACY_CLIENT_ID_KEY);
  db.close();
};

const idbError = (): DOMException => new DOMException('read failed', 'UnknownError');

describe('ClientIdService', () => {
  let service: ClientIdService;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [ClientIdService] });
    service = TestBed.inject(ClientIdService);
    await clearSupOps();
    await clearPf();
  });

  afterEach(async () => {
    await clearSupOps();
    await clearPf();
    service.clearCache();
  });

  describe('resolution from SUP_OPS', () => {
    it('returns a populated SUP_OPS id directly without opening pf', async () => {
      await seedSupOps('B_H8AR');
      const pfSpy = spyOn(service as any, '_readPf').and.callThrough();

      expect(await service.loadClientId()).toBe('B_H8AR');
      expect(pfSpy).not.toHaveBeenCalled();
    });

    it('caches the id after the first load', async () => {
      await seedSupOps('B_H8AR');
      const first = await service.loadClientId();
      // Remove the stored value — a second load must still return the cache.
      await clearSupOps();
      expect(await service.loadClientId()).toBe(first);
    });
  });

  describe('one-time migration from legacy pf', () => {
    it('migrates pf.__client_id_ into SUP_OPS, unchanged', async () => {
      await seedPf(PF_CLIENT_ID_KEY, 'B_H8AR');

      expect(await service.loadClientId()).toBe('B_H8AR');
      expect(await readSupOps()).toBe('B_H8AR');
    });

    it('migrates pf.CLIENT_ID when __client_id_ is absent (bridge-ordering gap)', async () => {
      await seedPf(PF_LEGACY_CLIENT_ID_KEY, 'LegacyId123456');

      expect(await service.loadClientId()).toBe('LegacyId123456');
      expect(await readSupOps()).toBe('LegacyId123456');
    });

    it('prefers __client_id_ over CLIENT_ID when both pf keys are valid', async () => {
      await seedPf(PF_CLIENT_ID_KEY, 'B_aaaa');
      await seedPf(PF_LEGACY_CLIENT_ID_KEY, 'LegacyId123456');

      expect(await service.loadClientId()).toBe('B_aaaa');
      expect(await readSupOps()).toBe('B_aaaa');
    });

    it('lets a valid pf id win over an invalid-format SUP_OPS value', async () => {
      await seedSupOps('BAD');
      await seedPf(PF_CLIENT_ID_KEY, 'B_good');

      expect(await service.loadClientId()).toBe('B_good');
      expect(await readSupOps()).toBe('B_good');
    });
  });

  describe('nothing stored anywhere', () => {
    it('loadClientId() resolves to null', async () => {
      expect(await service.loadClientId()).toBeNull();
    });

    it('getOrGenerateClientId() generates and persists a fresh id', async () => {
      const id = await service.getOrGenerateClientId();
      expect(/^[BEAI]_[a-zA-Z0-9]{4}$/.test(id)).toBeTrue();
      expect(await readSupOps()).toBe(id);

      // Persisted: a fresh service instance resolves to the same id.
      service.clearCache();
      expect(await service.loadClientId()).toBe(id);
    });

    it('converges two concurrent getOrGenerateClientId() calls on one id', async () => {
      const [a, b] = await Promise.all([
        service.getOrGenerateClientId(),
        service.getOrGenerateClientId(),
      ]);
      expect(a).toBe(b);
      expect(await readSupOps()).toBe(a);
    });

    it('opens the SUP_OPS connection once for concurrent cold-start callers', async () => {
      // Regression guard: without the in-flight-promise dedup in _getSupOpsDb,
      // each racing caller opens — and leaks — its own SUP_OPS connection.
      const openSpy = spyOn(service as any, '_openSupOpsDb').and.callThrough();

      await Promise.all([
        service.getOrGenerateClientId(),
        service.getOrGenerateClientId(),
      ]);

      expect(openSpy).toHaveBeenCalledTimes(1);
    });
  });

  // The data-safety core: a transient IndexedDB read failure must NEVER mint a
  // brand new clientId — that would orphan the device's real identity (#7732).
  describe('IndexedDB read failures never generate a new id', () => {
    it('SUP_OPS read throws: loadClientId() -> null, getOrGenerateClientId() throws', async () => {
      spyOn(service as any, '_getSupOpsDb').and.returnValue(
        Promise.resolve({ get: () => Promise.reject(idbError()) }),
      );

      expect(await service.loadClientId()).toBeNull();
      service.clearCache();
      await expectAsync(service.getOrGenerateClientId()).toBeRejected();
      // Nothing was minted into SUP_OPS.
      expect(await readSupOps()).toBeUndefined();
    });

    it('pf read throws: loadClientId() -> null, getOrGenerateClientId() throws', async () => {
      spyOn(service as any, '_readPf').and.returnValue(Promise.reject(idbError()));

      expect(await service.loadClientId()).toBeNull();
      service.clearCache();
      await expectAsync(service.getOrGenerateClientId()).toBeRejected();
      expect(await readSupOps()).toBeUndefined();
    });

    it('copy-forward write fails: returns the valid pf id, no throw, no generation', async () => {
      await seedPf(PF_CLIENT_ID_KEY, 'B_good');
      spyOn(service as any, '_putClientIdIfAbsent').and.returnValue(
        Promise.reject(new DOMException('quota', 'QuotaExceededError')),
      );

      expect(await service.loadClientId()).toBe('B_good');
      service.clearCache();
      expect(await service.getOrGenerateClientId()).toBe('B_good');
      // The failed copy means SUP_OPS stays empty — a later launch retries it.
      expect(await readSupOps()).toBeUndefined();
    });
  });

  describe('getOrGenerateClientId()', () => {
    it('returns an existing valid SUP_OPS id without generating', async () => {
      await seedSupOps('B_H8AR');
      expect(await service.getOrGenerateClientId()).toBe('B_H8AR');
    });

    it('generates when the stored value is an invalid format', async () => {
      await seedSupOps('BAD');
      const id = await service.getOrGenerateClientId();
      expect(/^[BEAI]_[a-zA-Z0-9]{4}$/.test(id)).toBeTrue();
    });
  });

  describe('persistClientId()', () => {
    it('writes the id into SUP_OPS and sets the cache', async () => {
      await service.persistClientId('E_abcd');
      expect(await readSupOps()).toBe('E_abcd');
      // Cache is set — loadClientId() returns it without re-reading.
      expect(await service.loadClientId()).toBe('E_abcd');
    });

    it('writes unconditionally, overwriting an existing SUP_OPS id', async () => {
      await seedSupOps('B_old1');
      await service.persistClientId('LegacyId123456');
      expect(await readSupOps()).toBe('LegacyId123456');
    });

    it('rejects an invalid-format id without persisting', async () => {
      await expectAsync(service.persistClientId('BAD')).toBeRejected();
      expect(await readSupOps()).toBeUndefined();
    });
  });
});
