import type { Page } from '@playwright/test';

/**
 * Store/archive facts for the tag-delete vs archive E2E specs (#11466).
 *
 * Only ids leave the page, never titles, so nothing user-like is logged.
 */

/**
 * Tag ids of one task in this client's young archive (`SUP_OPS`/`archive_young`,
 * key `current`), or null when the task is not archived there.
 * Call it only after the app has booted (the DB is opened without a version).
 */
export const getArchiveYoungTaskTagIds = async (
  page: Page,
  taskId: string,
): Promise<string[] | null> =>
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
        { data?: { task?: { entities?: Record<string, { tagIds?: string[] }> } } } | undefined
      >((resolve, reject) => {
        const tx = db.transaction('archive_young', 'readonly');
        const request = tx.objectStore('archive_young').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const t = archive?.data?.task?.entities?.[id];
      return t ? [...(t.tagIds ?? [])] : null;
    } finally {
      db.close();
    }
  }, taskId);

type StoreRoot = {
  tasks: { entities: Record<string, { id: string; tagIds?: string[] } | undefined> };
  tag: { entities: Record<string, { id: string; title: string } | undefined> };
};

const waitForStoreHelper = async (page: Page): Promise<void> => {
  // The store helper is attached after bootstrap via a dynamic import.
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __e2eTestHelpers?: { store?: unknown } }).__e2eTestHelpers
        ?.store,
    undefined,
    { timeout: 10000 },
  );
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
        __e2eTestHelpers: {
          store: {
            subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let root: StoreRoot | undefined;
    // The NgRx store replays its current value synchronously on subscribe.
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const match = Object.values(root?.tag.entities ?? {}).find(
      (t) => !!t && t.title === wantedTitle,
    );
    return match ? match.id : null;
  }, title);
};

/** Tag ids of a live task, or null when the task is not in the live store. */
export const getStoreTaskTagIds = async (
  page: Page,
  taskId: string,
): Promise<string[] | null> => {
  await waitForStoreHelper(page);
  return page.evaluate((id) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let root: StoreRoot | undefined;
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const t = root?.tasks.entities[id];
    return t ? [...(t.tagIds ?? [])] : null;
  }, taskId);
};
