import type { Page } from '@playwright/test';

/** One IndexedDB transaction the page ran, with its request counts by method. */
export interface IdbTransactionRecord {
  stores: string;
  mode: string;
  startedAt: number;
  durationMs: number;
  outcome: 'complete' | 'abort';
  requests: Record<string, number>;
}

/** Large transactions in start order; the rest grouped by stores and mode. */
export interface IdbTransactionTiming {
  large: IdbTransactionRecord[];
  small: Record<string, { count: number; summedMs: number; requests: number }>;
}

interface TimingWindow {
  __idbTiming?: IdbTransactionTiming;
}

// Runs in the page before app code, so every transaction the op-log opens is
// seen; self-contained because Playwright serializes it into the page. Each
// op-log stage (append, reducer commit, mark applied) is one transaction, so
// its wall time is that stage's database time, and the gaps between them are
// the non-database work.
const recordIdbTransactions = (minRequests: number): void => {
  const timing: IdbTransactionTiming = { large: [], small: {} };
  (window as unknown as TimingWindow).__idbTiming = timing;
  const records = new WeakMap<IDBTransaction, IdbTransactionRecord>();

  const finish = (record: IdbTransactionRecord, outcome: 'complete' | 'abort'): void => {
    record.durationMs = Date.now() - record.startedAt;
    record.outcome = outcome;
    const total = Object.values(record.requests).reduce((sum, n) => sum + n, 0);
    if (total >= minRequests || record.durationMs >= 1000) {
      timing.large.push(record);
      return;
    }
    const key = `${record.stores}|${record.mode}`;
    const group = (timing.small[key] ??= { count: 0, summedMs: 0, requests: 0 });
    group.count += 1;
    group.summedMs += record.durationMs;
    group.requests += total;
  };

  const originalTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase['transaction']>
  ): IDBTransaction {
    const tx = originalTransaction.apply(this, args);
    const record: IdbTransactionRecord = {
      stores: Array.from(tx.objectStoreNames).join('+'),
      mode: tx.mode,
      startedAt: Date.now(),
      durationMs: 0,
      outcome: 'complete',
      requests: {},
    };
    records.set(tx, record);
    tx.addEventListener('complete', () => finish(record, 'complete'));
    tx.addEventListener('abort', () => finish(record, 'abort'));
    return tx;
  };

  const countOn = <T extends object>(
    proto: T,
    methods: { prefix: string; names: string[] },
    txOf: (self: T) => IDBTransaction | null,
  ): void => {
    const target = proto as unknown as Record<string, unknown>;
    for (const name of methods.names) {
      const original = target[name];
      if (typeof original !== 'function') continue;
      const label = methods.prefix + name;
      target[name] = function (this: T, ...args: unknown[]): unknown {
        const tx = txOf(this);
        const record = tx ? records.get(tx) : undefined;
        if (record) record.requests[label] = (record.requests[label] ?? 0) + 1;
        return original.apply(this, args);
      };
    }
  };
  const reads = [
    'get',
    'getKey',
    'getAll',
    'getAllKeys',
    'count',
    'openCursor',
    'openKeyCursor',
  ];
  countOn(
    IDBObjectStore.prototype,
    { prefix: '', names: [...reads, 'put', 'add', 'delete', 'clear'] },
    (store) => store.transaction,
  );
  countOn(
    IDBIndex.prototype,
    { prefix: 'index.', names: reads },
    (index) => index.objectStore.transaction,
  );
  countOn(
    IDBCursor.prototype,
    {
      prefix: 'cursor.',
      names: ['continue', 'continuePrimaryKey', 'advance', 'update', 'delete'],
    },
    (cursor) => cursor.request.transaction,
  );
};

/**
 * Records every IndexedDB transaction of each later navigation. Call before the
 * page loads (or reload after), then read with {@link readIdbTransactionTiming}.
 */
export const installIdbTransactionTiming = async (
  page: Page,
  minRequests = 200,
): Promise<void> => {
  await page.addInitScript(recordIdbTransactions, minRequests);
};

/** Returns what {@link installIdbTransactionTiming} recorded so far. */
export const readIdbTransactionTiming = (page: Page): Promise<IdbTransactionTiming> =>
  page.evaluate(
    () => (window as unknown as TimingWindow).__idbTiming ?? { large: [], small: {} },
  );
