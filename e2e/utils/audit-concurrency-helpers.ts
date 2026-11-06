import { expect, type Locator, type Route } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import {
  routeSuperSyncOps,
  SUPERSYNC_BASE_URL,
  unrouteSuperSyncOps,
  type SimulatedE2EClient,
} from './supersync-helpers';
import { ImportPage } from '../pages/import.page';

/**
 * Helpers for the concurrency specs of the 2026-11-03 sync E2E audit
 * (Verify 3). They read the live store (`window.__e2eTestHelpers.store`) and
 * the local op log, hold an upload so a real CONFLICT_CONCURRENT happens on the
 * server, and run one sync cycle without syncAndWait()'s trailing flushes.
 * They never log entity content: callers log ids, counts and test-generated
 * titles only.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The stored title of a task created with `workView.addTask(name)`:
 * createSimulatedClient prefixes every new task with `<client>-<testRunId>-`.
 */
export const createdTitle = (
  creatorName: string,
  testRunId: string,
  name: string,
): string => `${creatorName}-${testRunId}-${name}`;

/** A task as the live store holds it, reduced to the fields the specs compare. */
export interface StoreTask {
  id: string;
  title: string;
  isDone: boolean;
  parentId: string | null;
  subTaskIds: string[];
}

/** A simple counter as the live store holds it. */
export interface StoreCounter {
  id: string;
  title: string;
  type: string | null;
  isEnabled: boolean | null;
  countOnDay: Record<string, number>;
}

/**
 * One synchronous snapshot of the live NgRx root state, reduced to tasks and
 * simple counters. `subscribe` on a Store emits the current value synchronously.
 */
const readStoreSlices = async (
  client: Pick<SimulatedE2EClient, 'page'>,
): Promise<{ tasks: StoreTask[]; counters: StoreCounter[] }> =>
  client.page.evaluate(() => {
    type Slice = { ids?: string[]; entities?: Record<string, Record<string, unknown>> };
    type Root = { tasks?: Slice; simpleCounter?: Slice };
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: { subscribe: (fn: (s: Root) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('window.__e2eTestHelpers.store is not available');
    }
    let root: Root | undefined;
    store.subscribe((s) => (root = s)).unsubscribe();
    const entities = (slice?: Slice): Record<string, unknown>[] =>
      Object.values(slice?.entities ?? {});
    const tasks = entities(root?.tasks).map((t) => ({
      id: String(t.id),
      title: String(t.title),
      isDone: t.isDone === true,
      parentId: typeof t.parentId === 'string' ? t.parentId : null,
      subTaskIds: Array.isArray(t.subTaskIds) ? (t.subTaskIds as string[]) : [],
    }));
    const counters = entities(root?.simpleCounter).map((c) => ({
      id: String(c.id),
      title: String(c.title),
      type: typeof c.type === 'string' ? c.type : null,
      isEnabled: typeof c.isEnabled === 'boolean' ? c.isEnabled : null,
      countOnDay:
        typeof c.countOnDay === 'object' && c.countOnDay !== null
          ? (c.countOnDay as Record<string, number>)
          : {},
    }));
    return { tasks, counters };
  });

/** Every task in the live store. */
export const readStoreTasks = async (
  client: Pick<SimulatedE2EClient, 'page'>,
): Promise<StoreTask[]> => (await readStoreSlices(client)).tasks;

/** The task with exactly this title, or null. Throws on duplicates. */
export const getStoreTaskByTitle = async (
  client: Pick<SimulatedE2EClient, 'page'>,
  title: string,
): Promise<StoreTask | null> => {
  const matches = (await readStoreTasks(client)).filter((t) => t.title === title);
  if (matches.length > 1) {
    throw new Error(`${matches.length} tasks share the title ${title}`);
  }
  return matches[0] ?? null;
};

/** Titles of all stored tasks whose title contains `marker`, sorted. */
export const getStoreTitlesContaining = async (
  client: Pick<SimulatedE2EClient, 'page'>,
  marker: string,
): Promise<string[]> =>
  (await readStoreTasks(client))
    .map((t) => t.title)
    .filter((title) => title.includes(marker))
    .sort();

/** Every simple counter in the live store. */
export const readStoreCounters = async (
  client: Pick<SimulatedE2EClient, 'page'>,
): Promise<StoreCounter[]> => (await readStoreSlices(client)).counters;

/** The counter with exactly this title, or null. */
export const getStoreCounterByTitle = async (
  client: Pick<SimulatedE2EClient, 'page'>,
  title: string,
): Promise<StoreCounter | null> =>
  (await readStoreCounters(client)).find((c) => c.title === title) ?? null;

/**
 * Local op-log entries: compact action code (`a`), opType, entityType,
 * entityId, whether it was synced and whether it came from this client.
 */
export const readOpLogEntries = async (
  client: Pick<SimulatedE2EClient, 'page'>,
): Promise<
  {
    actionCode: string;
    opType: string;
    entityType: string;
    entityId: string;
    isSynced: boolean;
    isRejected: boolean;
    source: string;
  }[]
> =>
  client.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('ops')) return [];
      const entries = await new Promise<
        {
          op: { a?: string; o?: string; e?: string; d?: string };
          syncedAt?: number;
          rejectedAt?: number;
          source?: string;
        }[]
      >((resolve, reject) => {
        const request = db.transaction('ops', 'readonly').objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return entries.map((entry) => ({
        actionCode: entry.op.a ?? '',
        opType: entry.op.o ?? '',
        entityType: entry.op.e ?? '',
        entityId: entry.op.d ?? '',
        isSynced: entry.syncedAt !== undefined,
        isRejected: entry.rejectedAt !== undefined,
        source: entry.source ?? '',
      }));
    } finally {
      db.close();
    }
  });

/** Ops that are neither synced nor rejected (what syncAndWait() would flush). */
const getPendingOpCount = async (
  client: Pick<SimulatedE2EClient, 'page'>,
): Promise<number> =>
  (await readOpLogEntries(client)).filter((e) => !e.isSynced && !e.isRejected).length;

/**
 * Exactly one sync cycle: SuperSyncPage.triggerSync() clicks sync and waits for
 * its completion, without syncAndWait()'s post-sync dialog handling and up to
 * three trailing flush cycles. Returns the ops still pending once the cycle's
 * writes are flushed, so a caller can assert the cycle uploaded everything it
 * created (e.g. an LWW local-win op) by itself.
 */
export const syncSingleCycle = async (client: SimulatedE2EClient): Promise<number> => {
  await client.sync.triggerSync();
  await client.page.evaluate(async () => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers?: { flushPendingWrites?: () => Promise<unknown> };
      }
    ).__e2eTestHelpers;
    await helpers?.flushPendingWrites?.();
  });
  return getPendingOpCount(client);
};

/** Server results and POST counts per client, from the ops endpoint. */
export interface SyncTraffic {
  /** `${clientName}:${errorCode}` for every rejected op result. */
  rejections: string[];
  /** Number of ops uploads (POST /api/sync/ops) per client name. */
  posts: Record<string, number>;
}

export const recordSyncTraffic = (clients: SimulatedE2EClient[]): SyncTraffic => {
  const traffic: SyncTraffic = { rejections: [], posts: {} };
  for (const client of clients) {
    traffic.posts[client.clientName] = 0;
    client.page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/sync/ops')) {
        traffic.posts[client.clientName]++;
      }
    });
    client.page.on('response', async (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/sync/ops')
      ) {
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
      for (const result of results) {
        if (isRecord(result) && result.accepted === false) {
          traffic.rejections.push(`${client.clientName}:${String(result.errorCode)}`);
        }
      }
    });
  }
  return traffic;
};

/**
 * Runs `sync` on `client` with its first ops upload (POST) held until
 * `duringHold` finished. A sync downloads before it uploads, so this is the
 * only way to get another client's op onto the server between this client's
 * download and its upload: the server then rejects the held upload as
 * CONFLICT_CONCURRENT. Pattern: supersync-time-delta-rejected-upload-new-delta.spec.ts.
 *
 * The route is always removed. An error from `duringHold` is reported in
 * preference to the sync's own failure, which it usually causes; the call
 * fails if no upload was held.
 */
export const syncWithHeldUpload = async <T>(
  client: SimulatedE2EClient,
  duringHold: () => Promise<void>,
  sync: () => Promise<T>,
): Promise<T> => {
  let held = false;
  let holdError: unknown;
  await routeSuperSyncOps(client.page, async (route: Route) => {
    if (route.request().method() !== 'POST' || held) {
      return route.continue();
    }
    held = true;
    try {
      await duringHold();
    } catch (error) {
      holdError = error;
    } finally {
      // A held upload would otherwise hang the sync until the test timeout.
      await route.continue();
    }
  });
  let result: T;
  try {
    result = await sync();
  } catch (syncError) {
    throw holdError ?? syncError;
  } finally {
    await unrouteSuperSyncOps(client.page);
  }
  if (holdError) throw holdError;
  expect(held, `${client.clientName}: no upload was held`).toBe(true);
  return result;
};

/**
 * Move a task in the list with Ctrl+Shift+Arrow. A centre click enters title
 * editing, where the shortcut never fires, so the task host is focused instead
 * (pattern: webdav-sync-today-tag.spec.ts). Each press waits for the move to
 * land: TaskService.moveUp/moveDown read the order asynchronously, so a press
 * sent before the previous move is applied can compute the same move and be lost.
 */
export const moveTaskWithKeyboard = async (
  task: Locator,
  direction: 'up' | 'down',
  times: number,
): Promise<void> => {
  const position = (): Promise<number> =>
    task.evaluate((el) => Array.from(document.querySelectorAll('task')).indexOf(el));
  await task.focus();
  await expect(task).toBeFocused();
  for (let i = 0; i < times; i++) {
    const before = await position();
    await task.press(
      direction === 'up' ? 'Control+Shift+ArrowUp' : 'Control+Shift+ArrowDown',
    );
    await expect
      .poll(position, { message: `keyboard move ${i + 1}/${times} did not land` })
      .toBe(direction === 'up' ? before - 1 : before + 1);
  }
};

/** Visible task titles in list order (top-level and expanded subtasks). */
export const taskTitleLocator = (client: Pick<SimulatedE2EClient, 'page'>): Locator =>
  client.page.locator('task .task-title');

/**
 * Writes a copy of an e2e/fixtures backup whose `active-task-2` is renamed to
 * `markerTitle`, so two clients can import distinguishable backups.
 */
export const writeMarkedBackup = (
  fixtureName: string,
  markerTitle: string,
  outPath: string,
): string => {
  const backup = JSON.parse(
    readFileSync(ImportPage.getFixturePath(fixtureName), 'utf-8'),
  );
  const task = backup?.data?.task?.entities?.['active-task-2'];
  if (!isRecord(task)) {
    throw new Error(`${fixtureName} has no active-task-2 to mark`);
  }
  task.title = markerTitle;
  writeFileSync(outPath, JSON.stringify(backup));
  return outPath;
};

/** Ops the server stores for a user (SuperSync TEST_MODE endpoint). */
export const getServerOps = async (
  userId: number,
): Promise<{ id: string; opType: string; serverSeq: number; clientId?: string }[]> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=500`,
  );
  if (!response.ok) {
    throw new Error(`Failed to read server ops: ${response.status}`);
  }
  const body = (await response.json()) as {
    ops: { id: string; opType: string; serverSeq: number; clientId?: string }[];
  };
  return body.ops;
};

/**
 * The whole simple counter entity with this id as the live store holds it, or
 * null. Unlike `readStoreCounters`, no field is dropped or coerced, so specs
 * can compare every persisted field across clients. Callers log test-generated
 * values only.
 */
export const readStoreCounterEntity = async (
  client: Pick<SimulatedE2EClient, 'page'>,
  id: string,
): Promise<Record<string, unknown> | null> =>
  client.page.evaluate((counterId) => {
    type Root = {
      simpleCounter?: { entities?: Record<string, Record<string, unknown>> };
    };
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: { subscribe: (fn: (s: Root) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('window.__e2eTestHelpers.store is not available');
    }
    let root: Root | undefined;
    store.subscribe((s) => (root = s)).unsubscribe();
    const entity = root?.simpleCounter?.entities?.[counterId];
    return entity
      ? (JSON.parse(JSON.stringify(entity)) as Record<string, unknown>)
      : null;
  }, id);
