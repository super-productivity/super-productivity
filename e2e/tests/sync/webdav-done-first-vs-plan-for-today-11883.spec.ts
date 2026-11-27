import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
  type WebDavConfig,
} from '../../utils/sync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #11883 on a file-based provider: the desktop completes a task, the phone
 * adds the same task to Today, neither has synced, and the desktop syncs
 * first. Done older: the phone's Today plan won whole-entity and its snapshot
 * undid the done on every device. Done newer: the plan lost and stayed on the
 * phone only. Both edits must reach every device in both orders, also after a
 * restart.
 */
interface Client {
  page: Page;
  sync: SyncPage;
  work: WorkViewPage;
}

interface TaskView {
  isDone: boolean;
  dueDay: string | null;
}

type StoreLike = {
  subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
  dispatch: (action: unknown) => void;
};

type Step = 'read' | 'unschedule' | 'done' | 'planForToday';

/**
 * Optionally dispatches the action the app dispatches for `step` (unschedule,
 * mark done, add to Today), then returns the task's done flag
 * and day.
 */
const onTask = async (page: Page, id: string, step: Step): Promise<TaskView> =>
  page.evaluate(
    async ({ taskId, taskStep }) => {
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) throw new Error('E2E store helper is unavailable');
      const meta = { isPersistent: true, entityType: 'TASK', opType: 'UPD' };
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
      if (taskStep === 'unschedule') {
        store.dispatch({
          type: '[Task Shared] unscheduleTask',
          id: taskId,
          isSkipToast: true,
          meta: { ...meta, entityId: taskId },
        });
      } else if (taskStep === 'done') {
        // TaskService.setDone
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: taskId, changes: { isDone: true } },
          meta: { ...meta, entityId: taskId },
        });
      } else if (taskStep === 'planForToday') {
        // TaskService.addToToday
        store.dispatch({
          type: '[Task Shared] planTasksForToday',
          taskIds: [taskId],
          today,
          startOfNextDayDiffMs: 0,
          meta: { ...meta, entityIds: [taskId], isBulk: true },
        });
      }
      const task = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ref: { current?: { unsubscribe: () => void } } = {};
        ref.current = store.subscribe((state) => {
          window.setTimeout(() => ref.current?.unsubscribe());
          const root = state as Record<string, { entities?: Record<string, unknown> }>;
          const found = (root.tasks ?? root.task)?.entities?.[taskId];
          if (found) resolve(found as Record<string, unknown>);
          else reject(new Error(`Task not found: ${taskId}`));
        });
      });
      return {
        isDone: task.isDone === true,
        dueDay: typeof task.dueDay === 'string' ? task.dueDay : null,
      };
    },
    { taskId: id, taskStep: step },
  );

/** The id of the task whose title contains `name`. */
const taskIdOf = async (page: Page, name: string): Promise<string> =>
  page.evaluate((title) => {
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    return new Promise<string>((resolve, reject) => {
      const ref: { current?: { unsubscribe: () => void } } = {};
      ref.current = store?.subscribe((state) => {
        window.setTimeout(() => ref.current?.unsubscribe());
        const root = state as Record<string, { entities?: Record<string, unknown> }>;
        const task = Object.values((root.tasks ?? root.task)?.entities ?? {}).find(
          (value) =>
            String((value as Record<string, unknown> | undefined)?.title).includes(title),
        ) as Record<string, unknown> | undefined;
        if (task) resolve(String(task.id));
        else reject(new Error(`Task not found: ${title}`));
      });
    });
  }, name);

test.describe('@webdav a done that syncs before another device adds it to Today (#11883)', () => {
  for (const doneIsNewer of [false, true]) {
    const order = doneIsNewer ? 'done is newer' : 'done is older';
    test(`keeps the done and the Today plan on both devices (${order})`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      const contexts: BrowserContext[] = [];
      const folder = generateSyncFolderName('e2e-done-first-today');
      await createSyncFolder(request, folder);
      const config: WebDavConfig = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      };
      const name = `DoneFirstToday-${testInfo.testId}`;
      const join = async (): Promise<Client> => {
        const { context, page } = await setupSyncClient(browser, baseURL);
        contexts.push(context);
        const client = { page, sync: new SyncPage(page), work: new WorkViewPage(page) };
        await client.work.waitForTaskList();
        await client.sync.setupWebdavSync(config);
        expect(await waitForSyncComplete(page, client.sync)).toBe('success');
        // From here on every sync is an explicit click, also after a reload.
        await page.addInitScript(() => {
          (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        await page.evaluate(() => {
          (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        return client;
      };
      const sync = async (client: Client): Promise<void> => {
        await client.sync.triggerSync();
        expect(await waitForSyncComplete(client.page, client.sync)).toBe('success');
      };
      try {
        const desktop = await join();
        await desktop.work.addTask(name);
        await expect(desktop.page.locator('task', { hasText: name })).toBeVisible();
        const id = await taskIdOf(desktop.page, name);
        expect((await onTask(desktop.page, id, 'unschedule')).dueDay).toBeNull();
        await sync(desktop);
        const phone = await join();
        await sync(phone);
        expect(await onTask(phone.page, id, 'read')).toEqual({
          isDone: false,
          dueDay: null,
        });

        let today: string | null;
        if (doneIsNewer) {
          ({ dueDay: today } = await onTask(phone.page, id, 'planForToday'));
          await phone.page.waitForTimeout(50);
          expect((await onTask(desktop.page, id, 'done')).isDone).toBe(true);
        } else {
          expect((await onTask(desktop.page, id, 'done')).isDone).toBe(true);
          await desktop.page.waitForTimeout(50);
          ({ dueDay: today } = await onTask(phone.page, id, 'planForToday'));
        }
        expect(today).not.toBeNull();
        // The desktop syncs first.
        await sync(desktop);
        await sync(phone);
        for (const client of [desktop, phone, desktop]) {
          await sync(client);
        }

        const expected = { isDone: true, dueDay: today };
        const expectConverged = async (): Promise<void> => {
          await expect
            .poll(
              async () => ({
                desktop: await onTask(desktop.page, id, 'read'),
                phone: await onTask(phone.page, id, 'read'),
              }),
              { timeout: 30000 },
            )
            .toEqual({ desktop: expected, phone: expected });
        };
        await expectConverged();

        // Replay is status-blind: a restart must reproduce live state.
        for (const client of [desktop, phone]) {
          await client.page.reload({ waitUntil: 'domcontentloaded' });
          await waitForAppReady(client.page);
        }
        await expectConverged();
      } finally {
        await closeContextsSafely(...contexts);
      }
    });
  }
});
