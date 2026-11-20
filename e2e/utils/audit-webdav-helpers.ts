import { expect, type Page } from '@playwright/test';
import { getArchiveYoungTaskIds } from './supersync-helpers';

/**
 * Helpers for the WebDAV sync E2E specs (audit 2026-11-03, "Verify 6").
 *
 * They read entity facts (ids, tagIds, projectId, dueDay) straight from the
 * NgRx store or the IndexedDB archive. Only ids and structural fields are
 * returned; titles never leave the page here so nothing user-like is logged.
 */

/** Structural fields of a task, as stored in the live state or the archive. */
export interface AuditTaskFacts {
  id: string;
  projectId: string | null;
  tagIds: string[];
  parentId: string | null;
  subTaskIds: string[];
  dueDay: string | null;
  isDone: boolean;
}

type RawTask = {
  id: string;
  title?: string;
  projectId?: string | null;
  tagIds?: string[];
  parentId?: string | null;
  subTaskIds?: string[];
  dueDay?: string | null;
  isDone?: boolean;
};

/**
 * One archived task from this client's young archive (`SUP_OPS`/`archive_young`,
 * key `current`, `.data.task.entities[id]`), or null when it is not there.
 * Call it only after the app has booted (the DB is opened without a version).
 */
export const getArchiveYoungTask = async (
  page: Page,
  taskId: string,
): Promise<AuditTaskFacts | null> =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('archive_young')) {
        return null;
      }
      const archive = await new Promise<
        | {
            data?: {
              task?: {
                ids?: string[];
                entities?: Record<
                  string,
                  {
                    id: string;
                    projectId?: string | null;
                    tagIds?: string[];
                    parentId?: string | null;
                    subTaskIds?: string[];
                    dueDay?: string | null;
                    isDone?: boolean;
                  }
                >;
              };
            };
          }
        | undefined
      >((resolve, reject) => {
        const tx = db.transaction('archive_young', 'readonly');
        const request = tx.objectStore('archive_young').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const t = archive?.data?.task?.entities?.[id];
      if (!t) {
        return null;
      }
      return {
        id: t.id,
        projectId: t.projectId ?? null,
        tagIds: [...(t.tagIds ?? [])],
        parentId: t.parentId ?? null,
        subTaskIds: [...(t.subTaskIds ?? [])],
        dueDay: t.dueDay ?? null,
        isDone: !!t.isDone,
      };
    } finally {
      db.close();
    }
  }, taskId);

/**
 * The store helper is attached after bootstrap via a dynamic import, so right
 * after a reload it can still be missing. Wait for it instead of throwing.
 */
const waitForStoreHelper = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __e2eTestHelpers?: { store?: unknown } }).__e2eTestHelpers
        ?.store,
    undefined,
    { timeout: 10000 },
  );
};

type StoreRoot = {
  tasks: { ids: string[]; entities: Record<string, RawTask | undefined> };
  tag: { ids: string[]; entities: Record<string, { id: string; title: string }> };
};

/**
 * Live NgRx store task, or null when `tasks.entities` has no such id. Archived
 * tasks are not in the live store, so null after an archive is the expected
 * result for an archived id.
 */
export const getStoreTask = async (
  page: Page,
  taskId: string,
): Promise<AuditTaskFacts | null> => {
  await waitForStoreHelper(page);
  return page.evaluate((id) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: {
            subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('E2E store helper is not available');
    }
    let root: StoreRoot | undefined;
    // The NgRx store replays its current value synchronously on subscribe.
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const t = root?.tasks.entities[id];
    if (!t) {
      return null;
    }
    return {
      id: t.id,
      projectId: t.projectId ?? null,
      tagIds: [...(t.tagIds ?? [])],
      parentId: t.parentId ?? null,
      subTaskIds: [...(t.subTaskIds ?? [])],
      dueDay: t.dueDay ?? null,
      isDone: !!t.isDone,
    };
  }, taskId);
};

/**
 * Id of the single live task whose title equals `title` exactly. Throws when
 * none or several match, so a test never asserts on the wrong entity.
 */
export const getStoreTaskIdByTitle = async (
  page: Page,
  title: string,
): Promise<string> => {
  await waitForStoreHelper(page);
  return page.evaluate((wantedTitle) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: {
            subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('E2E store helper is not available');
    }
    let root: StoreRoot | undefined;
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const matches = Object.values(root?.tasks.entities ?? {}).filter(
      (t): t is RawTask => !!t && t.title === wantedTitle,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one live task with that title, ${matches.length}`,
      );
    }
    return matches[0].id;
  }, title);
};

/** Id of the tag whose title equals `title`, or null when no such tag exists. */
export const getStoreTagIdByTitle = async (
  page: Page,
  title: string,
): Promise<string | null> => {
  await waitForStoreHelper(page);
  return page.evaluate((wantedTitle) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: {
            subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('E2E store helper is not available');
    }
    let root: StoreRoot | undefined;
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const tag = Object.values(root?.tag.entities ?? {}).find(
      (t) => !!t && t.title === wantedTitle,
    );
    return tag?.id ?? null;
  }, title);
};

/**
 * Starts recording whether `selector` ever matches an element in the page.
 * Pair it with {@link hasEverAppeared}: a plain "not visible" check after the
 * fact misses a dialog that opened and closed (or was auto-answered) between.
 * The record lives on `window` and is lost on reload or navigation.
 */
export const recordIfEverAppears = async (
  page: Page,
  key: string,
  selector: string,
): Promise<void> => {
  await page.evaluate(
    ({ k, sel }) => {
      const w = window as unknown as {
        __auditSeen?: Record<string, boolean>;
        __auditObservers?: Record<string, MutationObserver>;
      };
      w.__auditSeen = w.__auditSeen ?? {};
      w.__auditObservers = w.__auditObservers ?? {};
      w.__auditObservers[k]?.disconnect();
      w.__auditSeen[k] = !!document.querySelector(sel);
      const observer = new MutationObserver(() => {
        if (!w.__auditSeen![k] && document.querySelector(sel)) {
          w.__auditSeen![k] = true;
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      w.__auditObservers[k] = observer;
    },
    { k: key, sel: selector },
  );
};

/** Whether the selector registered under `key` matched at any point. */
export const hasEverAppeared = async (page: Page, key: string): Promise<boolean> =>
  page.evaluate((k) => {
    const w = window as unknown as {
      __auditSeen?: Record<string, boolean>;
      __auditObservers?: Record<string, MutationObserver>;
    };
    if (!w.__auditSeen || !(k in w.__auditSeen)) {
      throw new Error(`No appearance record "${k}"; call recordIfEverAppears first`);
    }
    w.__auditObservers?.[k]?.disconnect();
    return w.__auditSeen[k];
  }, key);

/**
 * Asserts each id is archived on this client: present in `archive_young` and
 * absent from the live `tasks.entities`. "Not in the work view" alone also
 * passes for a deleted task, which is the regression this guards against.
 */
export const expectArchivedNotLive = async (
  page: Page,
  taskIds: readonly string[],
  label: string,
): Promise<void> => {
  for (const id of taskIds) {
    await expect
      .poll(async () => (await getArchiveYoungTaskIds(page)).includes(id), {
        timeout: 10000,
        message: `${label}: task must be in archive_young`,
      })
      .toBe(true);
    expect(await getStoreTask(page, id), `${label}: task must not be live`).toBeNull();
  }
};

/** The browser's local calendar date `offsetDays` from now, as YYYY-MM-DD. */
export const getBrowserLocalDateStr = async (
  page: Page,
  offsetDays: number,
): Promise<string> =>
  page.evaluate((offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, offsetDays);

/** WebDAV methods that change the remote folder. */
const WRITE_METHODS = new Set(['PUT', 'MOVE', 'COPY', 'DELETE']);

/**
 * Counts write requests (PUT, MOVE, COPY, DELETE) this page sends into the
 * given WebDAV folder. With `fileNames` only those files count; without it any
 * file does, which also covers immutable `sync-state__*` snapshots, backups
 * and lock files. Register it before the sync under test.
 */
export const countWebdavWrites = (
  page: Page,
  folderPath: string,
  fileNames?: readonly string[],
): (() => number) => {
  let count = 0;
  const folder = `/${folderPath.replace(/^\/+|\/+$/g, '')}/`;
  page.on('request', (req) => {
    if (!WRITE_METHODS.has(req.method())) {
      return;
    }
    const path = new URL(req.url()).pathname;
    const isInFolder = fileNames
      ? fileNames.some((name) => path.endsWith(`${folder}${name}`))
      : path.includes(folder);
    if (isInFolder) {
      count++;
    }
  });
  return () => count;
};
