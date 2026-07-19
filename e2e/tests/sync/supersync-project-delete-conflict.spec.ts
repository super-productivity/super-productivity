import { test, expect } from '../../fixtures/supersync.fixture';
import type { BrowserContext, Page } from '@playwright/test';
import { ProjectPage } from '../../pages/project.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeClient,
  createProjectReliably,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
  type RuntimeBrowserError,
} from '../../utils/runtime-errors';

type ProjectDeleteOpSnapshot = {
  allTaskIds: string[];
  clientId: string;
  id: string;
  isMarked: boolean;
  projectId: string;
  source: 'local' | 'remote';
};

const getProjectDeleteOps = async (page: Page): Promise<ProjectDeleteOpSnapshot[]> =>
  page.evaluate(async () => {
    type StoredEntry = {
      op?: {
        a?: string;
        c?: string;
        id?: string;
        p?: unknown;
      };
      rejectedAt?: number;
      source?: 'local' | 'remote';
      syncedAt?: number;
    };
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      if (!db.objectStoreNames.contains('ops')) return [];
      const entries = await new Promise<StoredEntry[]>((resolve, reject) => {
        const transaction = db.transaction('ops', 'readonly');
        const request = transaction.objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result as StoredEntry[]);
        request.onerror = () => reject(request.error);
      });

      return entries.flatMap((entry) => {
        const op = entry.op;
        if (!op || op.a !== 'HPD' || entry.rejectedAt !== undefined) return [];
        const payload = isRecord(op.p) ? op.p : null;
        const actionPayload =
          payload && isRecord(payload['actionPayload'])
            ? payload['actionPayload']
            : payload;
        if (
          !actionPayload ||
          typeof actionPayload['projectId'] !== 'string' ||
          !Array.isArray(actionPayload['allTaskIds']) ||
          typeof op.c !== 'string' ||
          typeof op.id !== 'string' ||
          (entry.source !== 'local' && entry.source !== 'remote')
        ) {
          return [];
        }
        return [
          {
            allTaskIds: actionPayload['allTaskIds'].filter(
              (taskId): taskId is string => typeof taskId === 'string',
            ),
            clientId: op.c,
            id: op.id,
            isMarked: actionPayload['projectDeleteWins'] === true,
            projectId: actionPayload['projectId'],
            source: entry.source,
          },
        ];
      });
    } finally {
      db.close();
    }
  });

const getExistingTaskTitles = async (
  page: Page,
  expectedTitles: string[],
): Promise<string[]> =>
  page.evaluate((titles) => {
    type TaskLike = { title?: string };
    type StoreState = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }

    let latestState: StoreState | undefined;
    const subscription = store.subscribe((state) => {
      latestState = state;
    });
    subscription.unsubscribe();

    const expected = new Set(titles);
    return Object.values(latestState?.tasks?.entities ?? {}).flatMap((task) =>
      task?.title && expected.has(task.title) ? [task.title] : [],
    );
  }, expectedTitles);

const navigateToProject = async (
  client: SimulatedE2EClient,
  projectName: string,
): Promise<void> => {
  await new ProjectPage(client.page).navigateToProjectByName(projectName);
  await client.workView.waitForTaskList();
};

const createProjectWithTasks = async (
  client: SimulatedE2EClient,
  projectName: string,
  taskNames: string[],
): Promise<void> => {
  await createProjectReliably(client.page, projectName);
  await navigateToProject(client, projectName);
  for (const taskName of taskNames) {
    await client.workView.addTask(taskName);
  }
};

const enableProjectBacklog = async (page: Page, projectName: string): Promise<void> => {
  await expect(page.locator('page-title .page-title-text')).toHaveText(projectName);
  await page.locator('page-title .project-settings-btn').click();
  await page
    .locator('work-context-menu button[mat-menu-item]')
    .filter({ hasText: 'Settings' })
    .click();

  const dialog = page.locator('dialog-work-context-settings');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const backlogCheckbox = dialog.getByRole('switch', {
    name: 'Enable Project Backlog',
  });
  await expect(backlogCheckbox).not.toBeChecked();
  await backlogCheckbox.click();
  await expect(backlogCheckbox).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
};

const deleteProject = async (page: Page, projectName: string): Promise<void> => {
  await expect(page.locator('page-title .page-title-text')).toHaveText(projectName);
  await page.locator('page-title .project-settings-btn').click();

  const deleteMenuItem = page
    .locator('work-context-menu button[mat-menu-item]')
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

const expectProjectAndTasksDeleted = async (
  page: Page,
  projectName: string,
  taskNames: string[],
): Promise<void> => {
  const projectsTree = page
    .locator('nav-list-tree')
    .filter({ hasText: 'Projects' })
    .first();
  const groupHeader = projectsTree.locator('.g-multi-btn-wrapper').first();
  await groupHeader.hover();
  await groupHeader
    .locator('.additional-btns button')
    .filter({ has: page.locator('mat-icon', { hasText: 'visibility' }) })
    .click();
  await expect(
    page.locator('button[role="menuitemcheckbox"]').filter({ hasText: projectName }),
  ).toHaveCount(0, { timeout: 15000 });
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    window.location.hash = '#/tag/TODAY/tasks';
  });
  await page.waitForURL(/tag\/TODAY\/tasks/, { timeout: 15000 });
  await page.locator('task-list').first().waitFor({ state: 'visible', timeout: 15000 });

  for (const taskName of taskNames) {
    await expect(page.locator('task', { hasText: taskName })).toHaveCount(0, {
      timeout: 15000,
    });
  }

  // The UI check above covers visible lists; the store check catches unscheduled
  // orphan entities that would otherwise be invisible after their project is removed.
  await expect.poll(() => getExistingTaskTitles(page, taskNames)).toEqual([]);
};

const installConcurrentTabSupport = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
    localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
    localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
    localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');

    const testGlobal = globalThis as typeof globalThis & {
      __SP_E2E_BLOCK_AUTO_SYNC?: boolean;
      __SP_E2E_BLOCK_IMMEDIATE_UPLOAD?: boolean;
      __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean;
    };
    testGlobal.__SP_E2E_BLOCK_AUTO_SYNC = true;
    testGlobal.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    testGlobal.__SP_E2E_BLOCK_WS_DOWNLOAD = true;

    const NativeBroadcastChannel = globalThis.BroadcastChannel;
    class ConcurrentTabBroadcastChannel extends NativeBroadcastChannel {
      private readonly _isSingleInstanceChannel: boolean;

      constructor(name: string) {
        super(name);
        this._isSingleInstanceChannel = name === 'superProductivityTab';
      }

      override postMessage(message: unknown): void {
        if (!this._isSingleInstanceChannel) {
          super.postMessage(message);
        }
      }
    }

    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: ConcurrentTabBroadcastChannel,
    });
  });
};

test.describe('@supersync Project delete-wins conflict resolution', () => {
  test.describe.configure({ mode: 'serial' });

  test('remote project delete wins a concurrent edit and survives hydration replay', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const projectName = `DeleteWinsRemote-${testRunId}`;
      const taskNames = [
        `A-${testRunId}-DeleteWinsRemote-1`,
        `A-${testRunId}-DeleteWinsRemote-2`,
      ];

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await createProjectWithTasks(clientA, projectName, taskNames);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await navigateToProject(clientB, projectName);
      await waitForTask(clientB.page, taskNames[0]);
      await waitForTask(clientB.page, taskNames[1]);

      // Capture the delete first so the concurrent project edit is the newer operation.
      // Pre-#9009 timestamp LWW therefore resurrects the project; delete-wins must not.
      await deleteProject(clientA.page, projectName);
      await enableProjectBacklog(clientB.page, projectName);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      await expectProjectAndTasksDeleted(clientA.page, projectName, taskNames);
      await expectProjectAndTasksDeleted(clientB.page, projectName, taskNames);

      // Rebuild B from its operation log. Rejected/superseded conflict rows must
      // not turn the live deleted state into an empty project shell on replay.
      await clientB.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForAppReady(clientB.page, { ensureRoute: false });
      await expectProjectAndTasksDeleted(clientB.page, projectName, taskNames);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('local project delete replaces a newer remote edit and stays deleted after re-sync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const projectName = `DeleteWinsLocal-${testRunId}`;
      const taskNames = [
        `A-${testRunId}-DeleteWinsLocal-1`,
        `A-${testRunId}-DeleteWinsLocal-2`,
      ];

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await createProjectWithTasks(clientA, projectName, taskNames);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await navigateToProject(clientB, projectName);

      // B uploads the newer edit before A syncs its older local delete. A must
      // create a causally-dominating replacement delete instead of accepting B's edit.
      await deleteProject(clientA.page, projectName);
      await enableProjectBacklog(clientB.page, projectName);
      await clientB.sync.syncAndWait();

      await clientA.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      await expectProjectAndTasksDeleted(clientA.page, projectName, taskNames);
      await expectProjectAndTasksDeleted(clientB.page, projectName, taskNames);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('same-client concurrent tab deletes union their task cascades in the replacement', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let tabB2: Page | null = null;
    let tabB2RuntimeErrors: RuntimeBrowserError[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const projectName = `DeleteWinsUnion-${testRunId}`;
      const baselineTasks = [
        `A-${testRunId}-DeleteWinsUnion-1`,
        `A-${testRunId}-DeleteWinsUnion-2`,
      ];
      const tab1OnlyTask = `B-${testRunId}-DeleteWinsUnion-Tab1`;
      const tab2OnlyTask = `B-${testRunId}-DeleteWinsUnion-Tab2`;
      const allTaskNames = [...baselineTasks, tab1OnlyTask, tab2OnlyTask];

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await createProjectWithTasks(clientA, projectName, baselineTasks);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await navigateToProject(clientB, projectName);

      await installConcurrentTabSupport(clientB.context);
      tabB2 = await clientB.context.newPage();
      tabB2RuntimeErrors = attachPageErrorCollector(tabB2, 'Client B tab 2');
      installDevErrorDialogHandler(tabB2, 'Client B tab 2');
      await tabB2.goto(appUrl);
      await waitForAppReady(tabB2);
      await new ProjectPage(tabB2).navigateToProjectByName(projectName);
      const tab2WorkView = new WorkViewPage(tabB2);
      await tab2WorkView.waitForTaskList();

      // Each tab starts from the same baseline but adds a different task to its
      // in-memory project before deleting it. The shared op log then contains two
      // marked deletes with different allTaskIds cascade sets.
      await clientB.workView.addTask(tab1OnlyTask);
      await tab2WorkView.addTask(tab2OnlyTask);
      await deleteProject(clientB.page, projectName);
      await deleteProject(tabB2, projectName);

      let localDeleteOps: ProjectDeleteOpSnapshot[] = [];
      await expect
        .poll(async () => {
          localDeleteOps = (await getProjectDeleteOps(clientB.page)).filter(
            (op) => op.source === 'local',
          );
          return localDeleteOps.length;
        })
        .toBe(2);
      expect(new Set(localDeleteOps.map((op) => op.projectId)).size).toBe(1);
      expect(new Set(localDeleteOps.map((op) => op.clientId)).size).toBe(1);
      expect(localDeleteOps.every((op) => op.isMarked)).toBe(true);
      expect(
        new Set(localDeleteOps.map((op) => [...op.allTaskIds].sort().join(','))).size,
      ).toBe(2);
      const expectedCascadeTaskIds = new Set(
        localDeleteOps.flatMap((op) => op.allTaskIds),
      );
      expect(expectedCascadeTaskIds.size).toBe(allTaskNames.length);

      // A's later project edit is the remote conflict that makes B synthesize one
      // replacement delete. A receives the task creates plus only that replacement.
      await enableProjectBacklog(clientA.page, projectName);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      const projectId = localDeleteOps[0].projectId;
      let activeLocalDeletes: ProjectDeleteOpSnapshot[] = [];
      await expect
        .poll(async () => {
          activeLocalDeletes = (await getProjectDeleteOps(clientB.page)).filter(
            (op) => op.projectId === projectId && op.source === 'local',
          );
          return activeLocalDeletes.map((op) => ({
            allTaskIds: [...op.allTaskIds].sort(),
            isMarked: op.isMarked,
          }));
        })
        .toEqual([
          {
            allTaskIds: [...expectedCascadeTaskIds].sort(),
            isMarked: true,
          },
        ]);
      const replacementDeleteId = activeLocalDeletes[0].id;
      expect(localDeleteOps.map((op) => op.id)).not.toContain(replacementDeleteId);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      await expect
        .poll(async () => {
          const receivedDeletes = (await getProjectDeleteOps(clientA.page)).filter(
            (op) => op.projectId === projectId && op.source === 'remote',
          );
          return receivedDeletes.map((op) => ({
            allTaskIds: [...op.allTaskIds].sort(),
            id: op.id,
            isMarked: op.isMarked,
          }));
        })
        .toEqual([
          {
            allTaskIds: [...expectedCascadeTaskIds].sort(),
            id: replacementDeleteId,
            isMarked: true,
          },
        ]);

      await expectProjectAndTasksDeleted(clientA.page, projectName, allTaskNames);
      await expectProjectAndTasksDeleted(clientB.page, projectName, allTaskNames);
    } finally {
      if (tabB2 && !tabB2.isClosed()) await tabB2.close().catch(() => undefined);
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      assertNoRuntimeBrowserErrors(tabB2RuntimeErrors, 'Client B tab 2');
    }
  });
});
