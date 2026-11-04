import { expect, type Page } from '@playwright/test';
import { SUPERSYNC_BASE_URL } from './supersync-helpers';

/**
 * Store and archive readers for archive / worklog / absence checks.
 *
 * The worklog merges live and archived tasks, so "shown in the worklog" does not
 * prove a task was archived. These readers go to the source instead: the NgRx
 * store for live tasks and `SUP_OPS`/`archive_young` for archived ones.
 *
 * Absence checks are only meaningful next to a positive anchor: every reader
 * here fails loudly (or returns `null`) when the thing it reads is missing,
 * instead of returning an empty list that any absence check would accept.
 */

type PageHolder = { page: Page };

export type StoreTask = {
  id: string;
  title: string;
  isDone: boolean;
  parentId: string | null;
  projectId: string | null;
};

export type ArchivedTask = { id: string; title: string; parentId: string | null };

const pageOf = (target: Page | PageHolder): Page =>
  'page' in target ? target.page : target;

/**
 * Every task in the live NgRx store. Throws when the e2e store handle is
 * missing, so an absence check can never pass on an unbooted page.
 */
export const getActiveTasks = (target: Page | PageHolder): Promise<StoreTask[]> =>
  pageOf(target).evaluate(() => {
    type StoreLike = {
      subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('getActiveTasks: window.__e2eTestHelpers.store is missing');
    }
    type RawTask = {
      id: string;
      title: string;
      isDone: boolean;
      parentId?: string | null;
      projectId?: string | null;
    };
    type RootLike = { tasks?: { entities?: Record<string, RawTask | undefined> } };
    const holder: { state?: RootLike } = {};
    store.subscribe((s) => (holder.state = s as RootLike)).unsubscribe();
    const entities = holder.state?.tasks?.entities;
    if (!entities) {
      throw new Error('getActiveTasks: store has no tasks.entities');
    }
    return Object.values(entities)
      .filter((task): task is RawTask => !!task)
      .map(({ id, title, isDone, parentId, projectId }) => ({
        id,
        title,
        isDone,
        parentId: parentId ?? null,
        projectId: projectId ?? null,
      }));
  });

/** Id of the single live task whose title contains `title`. */
export const getTaskIdByTitle = async (
  target: Page | PageHolder,
  title: string,
): Promise<string> => {
  const matches = (await getActiveTasks(target)).filter((t) => t.title.includes(title));
  if (matches.length !== 1) {
    throw new Error(
      `getTaskIdByTitle: expected exactly one live task to match, found ${matches.length}`,
    );
  }
  return matches[0].id;
};

/** Ids of the live tasks among `ids`. */
export const getLiveIds = async (
  target: Page | PageHolder,
  ids: readonly string[],
): Promise<string[]> => {
  const live = new Set((await getActiveTasks(target)).map((t) => t.id));
  return ids.filter((id) => live.has(id));
};

/**
 * Tasks in this client's young archive (`SUP_OPS`/`archive_young`, key
 * `current`), or `null` when the store or its entry does not exist yet. A
 * `null` is not "nothing archived": callers that check absence must first
 * require a non-null result (or another positive anchor).
 */
export const getArchiveYoungTasks = (
  target: Page | PageHolder,
): Promise<ArchivedTask[] | null> =>
  pageOf(target).evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('archive_young')) {
        return null;
      }
      type RawArchived = { id: string; title: string; parentId?: string | null };
      const entry = await new Promise<
        | {
            data?: {
              task?: { ids?: string[]; entities?: Record<string, RawArchived> };
            };
          }
        | undefined
      >((resolve, reject) => {
        const tx = db.transaction('archive_young', 'readonly');
        const request = tx.objectStore('archive_young').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const taskState = entry?.data?.task;
      if (!taskState) {
        return null;
      }
      return (taskState.ids ?? []).map((id) => {
        const task = taskState.entities?.[id];
        return { id, title: task?.title ?? '', parentId: task?.parentId ?? null };
      });
    } finally {
      db.close();
    }
  });

const archivedIdsOrEmpty = async (target: Page | PageHolder): Promise<string[]> =>
  ((await getArchiveYoungTasks(target)) ?? []).map((t) => t.id);

/**
 * Polls until every id is in `archive_young` AND none of them is in the live
 * store. The archive membership is the positive anchor for the store absence.
 */
export const expectArchivedNotLive = async (
  target: Page | PageHolder,
  ids: readonly string[],
  label: string,
  timeout = 30000,
): Promise<void> => {
  await expect
    .poll(
      async () => (await archivedIdsOrEmpty(target)).filter((id) => ids.includes(id)),
      {
        message: `${label}: ids should be in archive_young`,
        timeout,
      },
    )
    .toEqual(expect.arrayContaining([...ids]));
  await expect
    .poll(() => getLiveIds(target, ids), {
      message: `${label}: archived ids should be gone from the live store`,
      timeout,
    })
    .toEqual([]);
};

/**
 * Asserts that none of `ids` is archived. Requires the `archive_young` entry to
 * exist, so "store missing" cannot pass as "not archived".
 */
export const expectNotInArchive = async (
  target: Page | PageHolder,
  ids: readonly string[],
  label: string,
): Promise<void> => {
  const archived = await getArchiveYoungTasks(target);
  expect(archived, `${label}: archive_young entry must exist (anchor)`).not.toBeNull();
  const hits = (archived ?? []).map((t) => t.id).filter((id) => ids.includes(id));
  expect(hits, `${label}: ids must not be archived`).toEqual([]);
};

// ============================================================================
// SERVER OP LOG (TEST_MODE route)
// ============================================================================

export type ServerOp = {
  id: string;
  clientId: string;
  opType: string;
  serverSeq: number;
};

/** Up to `limit` server ops for the user, newest first. */
export const getServerOps = async (userId: number, limit = 500): Promise<ServerOp[]> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=${limit}`,
  );
  if (!response.ok) {
    throw new Error(
      `getServerOps: ${response.status} ${await response.text().catch(() => '')}`,
    );
  }
  return ((await response.json()) as { ops: ServerOp[] }).ops;
};

/**
 * Asserts the server's history starts at its newest clean-slate import
 * (BACKUP_IMPORT, or the SYNC_IMPORT a "use my data" force upload creates):
 * that op must exist, and no op may have a lower serverSeq, because the clean
 * slate deletes everything before it. Returns the import's op type.
 */
export const expectServerHistoryStartsAtImport = async (
  userId: number,
  label: string,
): Promise<string> => {
  const ops = await getServerOps(userId);
  const newest = ops
    .filter((op) => op.opType === 'BACKUP_IMPORT' || op.opType === 'SYNC_IMPORT')
    .reduce<
      ServerOp | undefined
    >((acc, op) => (!acc || op.serverSeq > acc.serverSeq ? op : acc), undefined);
  expect(newest, `${label}: server must hold an import op (anchor)`).toBeDefined();
  const older = ops
    .filter((op) => op.serverSeq < (newest as ServerOp).serverSeq)
    .map((op) => `${op.opType}@${op.serverSeq}`);
  expect(older, `${label}: no server op may predate the import`).toEqual([]);
  return (newest as ServerOp).opType;
};

/** Server op types with their serverSeq, newest first, for logs (no payloads). */
export const getServerOpTypes = async (userId: number): Promise<string[]> =>
  (await getServerOps(userId)).map((op) => `${op.opType}@${op.serverSeq}`);

// ============================================================================
// "MUST NEVER APPEAR" WATCHER
// ============================================================================

const seenKey = (key: string): string => `__e2eNeverSeen_${key}`;

/**
 * Records in sessionStorage whether `selector` ever matched in this tab, from
 * now on and across reloads. Use it for dialogs the sync helpers would
 * otherwise answer silently. Call before the action under test.
 */
export const watchNeverAppears = async (
  page: Page,
  selector: string,
  key: string,
): Promise<void> => {
  const install = ({ sel, storageKey }: { sel: string; storageKey: string }): void => {
    const check = (): void => {
      if (document.querySelector(sel)) {
        try {
          sessionStorage.setItem(storageKey, '1');
        } catch {
          // ignore: the assertion then reports "not seen" only if it never matched
        }
      }
    };
    const start = (): void => {
      check();
      new MutationObserver(check).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    }
  };
  const arg = { sel: selector, storageKey: seenKey(key) };
  await page.addInitScript(install, arg);
  await page.evaluate(install, arg);
};

/** True when the watched selector matched at any point since watching began. */
export const hasEverAppeared = (page: Page, key: string): Promise<boolean> =>
  page.evaluate((storageKey) => sessionStorage.getItem(storageKey) === '1', seenKey(key));
