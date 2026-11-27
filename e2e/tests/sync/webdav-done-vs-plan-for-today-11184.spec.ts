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
 * #11184 on a file-based provider (reported on Dropbox, iOS): a task completed
 * on the desktop stays open on the phone, with no error, while later changes
 * still arrive; the remote file says done.
 *
 * The desktop completes an unscheduled task and has not synced yet; the phone
 * adds the same task to Today (`planTasksForToday`, also what tracking an
 * unscheduled task dispatches) and syncs first. On the desktop the done loses
 * whole-entity LWW to that opaque op: it was rejected but kept in the
 * desktop's state, so no op carried it to the phone. It must reach every
 * device, beside the phone's Today plan, also after a restart.
 *
 * Tracked: the desktop works on the task (planned for tomorrow, so starting it
 * does not plan it for today) and completes it while tracking. Its time delta
 * stays pending beside the losing done; the done and the time must still reach
 * the phone, the time once.
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

type Step = 'read' | 'unschedule' | 'done' | 'planForToday' | 'start';

/**
 * Optionally dispatches the action the app dispatches for `step` (unschedule,
 * mark done, add to Today, start tracking), then returns the task's done flag
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
      } else if (taskStep === 'start') {
        // TaskService.setCurrentId (the task's play button)
        store.dispatch({ type: '[Task] SetCurrentTask', id: taskId });
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

/** The task's tracked time in ms. */
const timeSpentOf = async (page: Page, id: string): Promise<number> =>
  page.evaluate((taskId) => {
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    return new Promise<number>((resolve, reject) => {
      const ref: { current?: { unsubscribe: () => void } } = {};
      ref.current = store?.subscribe((state) => {
        window.setTimeout(() => ref.current?.unsubscribe());
        const root = state as Record<string, { entities?: Record<string, unknown> }>;
        const task = (root.tasks ?? root.task)?.entities?.[taskId] as
          | Record<string, unknown>
          | undefined;
        if (task) resolve(Number(task.timeSpent ?? 0));
        else reject(new Error(`Task not found: ${taskId}`));
      });
    });
  }, id);

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

test.describe('@webdav a done that loses to another device adding it to Today (#11184)', () => {
  for (const isTracked of [false, true]) {
    const title = isTracked
      ? 'reaches the device that added it to Today, beside time tracked before it'
      : 'reaches the device that added it to Today';
    test(title, async ({ browser, baseURL, request, webdavServerUp }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      const contexts: BrowserContext[] = [];
      const folder = generateSyncFolderName('e2e-done-vs-today');
      await createSyncFolder(request, folder);
      const config: WebDavConfig = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      };
      const name = `DoneVsToday-${testInfo.testId}`;
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
        let id: string;
        if (isTracked) {
          // Planned for tomorrow: it leaves the Today list.
          await desktop.work.addTask(`${name} @tomorrow`, false, null);
          id = await taskIdOf(desktop.page, name);
        } else {
          await desktop.work.addTask(name);
          await expect(desktop.page.locator('task', { hasText: name })).toBeVisible();
          id = await taskIdOf(desktop.page, name);
          expect((await onTask(desktop.page, id, 'unschedule')).dueDay).toBeNull();
        }
        const { dueDay: plannedDay } = await onTask(desktop.page, id, 'read');
        await sync(desktop);
        const phone = await join();
        await sync(phone);
        expect(await onTask(phone.page, id, 'read')).toEqual({
          isDone: false,
          dueDay: plannedDay,
        });

        // The desktop completes the task, then the phone adds it to Today and
        // syncs first: the done is the older, losing side on the desktop.
        if (isTracked) {
          await onTask(desktop.page, id, 'start');
          await desktop.page.waitForTimeout(3000);
        }
        // Completing the current task stops tracking, which flushes its time.
        expect((await onTask(desktop.page, id, 'done')).isDone).toBe(true);
        // Not planned for today by tracking: only the phone's add plans it.
        expect((await onTask(desktop.page, id, 'read')).dueDay).toBe(plannedDay);
        const tracked = await timeSpentOf(desktop.page, id);
        expect(tracked > 0).toBe(isTracked);
        await desktop.page.waitForTimeout(50);
        const { dueDay: today } = await onTask(phone.page, id, 'planForToday');
        expect(today).not.toBeNull();
        await sync(phone);
        await sync(desktop);
        for (const client of [phone, desktop, phone]) {
          await sync(client);
        }

        const expected = { isDone: true, dueDay: today, timeSpent: tracked };
        const read = async (page: Page): Promise<typeof expected> => ({
          ...(await onTask(page, id, 'read')),
          timeSpent: await timeSpentOf(page, id),
        });
        const expectConverged = async (): Promise<void> => {
          await expect
            .poll(
              async () => ({
                desktop: await read(desktop.page),
                phone: await read(phone.page),
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
