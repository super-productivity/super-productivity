import { Invoice } from '../core/types';

type Store = typeof import('./store');

// Host fake modelled on PluginUserPersistenceService: writes commit only when
// commit() is called, reads return the pending value, the list shows only
// committed keys (emptied ones included).
const fakeHost = () => {
  const committed = new Map<string, string>();
  const pending = new Map<string, string>();
  const api = {
    persistDataSynced: jest.fn(async (data: string, key: string) => {
      pending.set(key, data);
    }),
    loadSyncedData: jest.fn(
      async (key: string) => pending.get(key) ?? committed.get(key) ?? null,
    ),
    listSyncedDataKeys: jest.fn(async (prefix: string) =>
      [...committed.keys()].filter((k) => k.startsWith(prefix)),
    ),
  };
  const commit = (): void => {
    for (const [key, data] of pending) committed.set(key, data);
    pending.clear();
  };
  return { api, commit };
};

const invoice = (id: string, seq: number): Invoice =>
  ({ id, seq, number: `00${seq}`, lines: [], billedMs: {} }) as unknown as Invoice;

const loadStore = (api: unknown): Store => {
  (globalThis as { PluginAPI?: unknown }).PluginAPI = api;
  let store!: Store;
  jest.isolateModules(() => {
    store = require('./store');
  });
  return store;
};

describe('store', () => {
  it('lists a just-issued invoice before the host has committed it', async () => {
    const { api, commit } = fakeHost();
    const store = loadStore(api);
    await store.saveInvoice(invoice('a', 1));
    expect((await store.loadInvoices()).map((i) => i.id)).toEqual(['a']);
    commit();
    expect((await store.loadInvoices()).map((i) => i.id)).toEqual(['a']);
  });

  it('hides a just-deleted invoice before the host has committed it', async () => {
    const { api, commit } = fakeHost();
    const store = loadStore(api);
    await store.saveInvoice(invoice('a', 1));
    commit();
    await store.deleteInvoice('a');
    expect(await store.loadInvoices()).toEqual([]);
  });

  it('forgets a write the host rejected', async () => {
    const { api } = fakeHost();
    api.persistDataSynced.mockRejectedValueOnce(new Error('too large'));
    const store = loadStore(api);
    await expect(store.saveInvoice(invoice('a', 1))).rejects.toThrow('too large');
    expect(await store.loadInvoices()).toEqual([]);
  });
});
