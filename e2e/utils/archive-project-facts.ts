import { expect, type Page } from '@playwright/test';

/**
 * Store/archive facts and actions for the project-delete vs archive E2E specs.
 *
 * Only ids leave the page, never titles, so nothing user-like is logged.
 */

/**
 * Project id of one task in this client's young archive (`SUP_OPS`/`archive_young`,
 * key `current`), `null` when the task is not archived there. An archived task
 * without a project yields `''`.
 * Call it only after the app has booted (the DB is opened without a version).
 */
export const getArchiveYoungTaskProjectId = async (
  page: Page,
  taskId: string,
): Promise<string | null> =>
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
        | { data?: { task?: { entities?: Record<string, { projectId?: string }> } } }
        | undefined
      >((resolve, reject) => {
        const tx = db.transaction('archive_young', 'readonly');
        const request = tx.objectStore('archive_young').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const t = archive?.data?.task?.entities?.[id];
      return t ? (t.projectId ?? '') : null;
    } finally {
      db.close();
    }
  }, taskId);

type StoreRoot = {
  tasks: { entities: Record<string, { id: string } | undefined> };
  projects: { entities: Record<string, { id: string; title: string } | undefined> };
};

type StoreLike = {
  subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
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

/** Id of the project whose title equals `title`, or null when none exists. */
export const getStoreProjectIdByTitle = async (
  page: Page,
  title: string,
): Promise<string | null> => {
  await waitForStoreHelper(page);
  return page.evaluate((wantedTitle) => {
    const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
      .__e2eTestHelpers.store;
    let root: StoreRoot | undefined;
    // The NgRx store replays its current value synchronously on subscribe.
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const match = Object.values(root?.projects.entities ?? {}).find(
      (p) => !!p && p.title === wantedTitle,
    );
    return match ? match.id : null;
  }, title);
};

/** True when the task is in the live store. */
export const isTaskInStore = async (page: Page, taskId: string): Promise<boolean> => {
  await waitForStoreHelper(page);
  return page.evaluate((id) => {
    const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
      .__e2eTestHelpers.store;
    let root: StoreRoot | undefined;
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    return !!root?.tasks.entities[id];
  }, taskId);
};

/**
 * Deletes the currently open project through its page-title menu.
 * The page must already show `projectName`.
 */
export const deleteOpenProject = async (
  page: Page,
  projectName: string,
): Promise<void> => {
  await expect(page.locator('page-title .page-title-text')).toHaveText(projectName);
  await page.locator('page-title .project-settings-btn').click();

  const deleteMenuItem = page
    .locator('.work-context-menu-panel button[mat-menu-item]')
    .filter({ hasText: 'Delete project' });
  await deleteMenuItem.waitFor({ state: 'visible', timeout: 5000 });
  await deleteMenuItem.click();

  const confirmBtn = page.locator('dialog-confirm button[e2e="confirmBtn"]');
  await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
  await confirmBtn.click();
  await page.locator('dialog-confirm').waitFor({ state: 'hidden', timeout: 5000 });
  await expect(page.locator('page-title .page-title-text')).not.toHaveText(projectName, {
    timeout: 10000,
  });
};
