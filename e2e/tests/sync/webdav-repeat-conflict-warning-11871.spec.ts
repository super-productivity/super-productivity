import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { TaskPage } from '../../pages/task.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  openRecurDialog,
  openRecurScheduleDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';
import { dispatch, pending, rows } from '../../utils/reorder-crossing';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';

const DAY_BEFORE = '2026-06-15T15:00:00';
const TITLE = 'Daily review';
const RENAMED_TITLE = 'Revised daily review';
const DISCARDED_TITLE = 'Earlier daily review';

const occurrence = (page: Page): ReturnType<Page['locator']> =>
  page.locator(
    'task[data-task-id^="rpt_"][data-task-id$="_2026-06-16"]:not(.ng-animating)',
  );

const syncClient = async ({
  page,
  sync,
}: {
  page: Page;
  sync: SyncPage;
}): Promise<void> => {
  await sync.triggerSync();
  expect(
    await waitForSyncComplete(page, sync, 60_000, { allowResponseOnlyCompletion: true }),
  ).toBe('success');
};

const renameOccurrence = async (page: Page, id: string, title: string): Promise<void> => {
  await dispatch(page, [
    {
      type: '[Task Shared] updateTask',
      task: { id, changes: { title } },
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    },
  ]);
  await expect(occurrence(page)).toContainText(title);
  await expect
    .poll(async () =>
      pending(await rows(page)).some(({ op }) => op.d === id && op.a === 'HU'),
    )
    .toBe(true);
};

test.describe('@webdav Concurrent recurring task warning (#11871)', () => {
  for (const scenario of ['local winner', 'remote winner', 'different title'] as const) {
    test(scenario, async ({ browser, baseURL, request, webdavServerUp }) => {
      expect(webdavServerUp).toBe(true);
      test.slow();
      const contexts: BrowserContext[] = [];
      const folder = generateSyncFolderName('e2e-repeat-conflict-11871');
      await createSyncFolder(request, folder);

      const join = async (): Promise<{ page: Page; sync: SyncPage }> => {
        const { context, page } = await setupSyncClient(browser, baseURL);
        contexts.push(context);
        await page.clock.setSystemTime(new Date(DAY_BEFORE));
        await page.reload();
        await new WorkViewPage(page).waitForTaskList();
        const sync = new SyncPage(page);
        await sync.setupWebdavSync({
          ...WEBDAV_CONFIG_TEMPLATE,
          syncFolderPath: `/${folder}`,
        });
        expect(await waitForSyncComplete(page, sync)).toBe('success');
        await page.evaluate(() => {
          (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        return { page, sync };
      };

      try {
        const first = await join();
        const taskPage = new TaskPage(first.page);
        await new WorkViewPage(first.page).addTask(TITLE);
        await taskPage.openTaskDetail(taskPage.getTaskByText(TITLE).first());
        await openRecurDialog(first.page);
        const schedule = await openRecurScheduleDialog(first.page);
        const timeField = schedule.getByLabel('Time');
        await timeField.fill('18:00');
        await timeField.blur();
        await schedule.locator('[data-test-id="schedule-submit-btn"]').click();
        await expect(schedule).toBeHidden();
        await saveRecurDialog(first.page);
        await first.page.keyboard.press('Escape');
        await syncClient(first);

        const second = await join();
        await expect(
          new TaskPage(second.page).getTaskByText(TITLE).first(),
        ).toBeVisible();
        for (const [client, time] of [
          [first, '2026-06-16T00:05:00'],
          [second, '2026-06-16T00:15:00'],
        ] as const) {
          await expect(occurrence(client.page)).toHaveCount(0);
          await client.page.clock.setSystemTime(new Date(time));
          await client.page.evaluate(() => window.dispatchEvent(new Event('focus')));
          await expect(occurrence(client.page)).toHaveCount(1, { timeout: 30_000 });
          await expect(occurrence(client.page)).toContainText(TITLE);
          const occurrenceId = await occurrence(client.page).getAttribute('data-task-id');
          await expect
            .poll(async () =>
              pending(await rows(client.page)).some(
                ({ op }) => op.d === occurrenceId && op.a === 'HS',
              ),
            )
            .toBe(true);
        }
        const id = (await occurrence(second.page).getAttribute('data-task-id')) ?? '';
        expect(id).not.toBe('');
        expect(await occurrence(first.page).getAttribute('data-task-id')).toBe(id);

        if (scenario === 'different title') {
          await renameOccurrence(first.page, id, DISCARDED_TITLE);
          await renameOccurrence(second.page, id, RENAMED_TITLE);
        }
        const [uploader, resolver] =
          scenario === 'remote winner' ? [second, first] : [first, second];
        const scheduled = ({ op }: Awaited<ReturnType<typeof rows>>[number]): boolean =>
          op.d === id && op.a === 'HS';
        await test.step('upload the first occurrence', () => syncClient(uploader));
        const uploaded = (await rows(uploader.page)).find(scheduled);
        expect(uploaded?.syncedAt).toBeDefined();
        await test.step('resolve concurrent occurrences', () => syncClient(resolver));
        const resolverRows = await rows(resolver.page);
        if (scenario === 'remote winner') {
          expect(
            resolverRows.find((row) => row.source === 'local' && scheduled(row))
              ?.rejectedAt,
          ).toBeDefined();
          const accepted = resolverRows.find(({ op }) => op.id === uploaded?.op.id);
          expect(accepted).toMatchObject({
            source: 'remote',
            applicationStatus: 'applied',
          });
          expect(accepted?.rejectedAt).toBeUndefined();
        } else {
          expect(
            resolverRows.some(
              (row) =>
                row.source === 'local' &&
                row.op.d === id &&
                row.op.a === '[TASK] LWW Update',
            ),
          ).toBe(true);
        }
        await test.step('sync the resolution back', () => syncClient(uploader));

        const expectedTitle = scenario === 'different title' ? RENAMED_TITLE : TITLE;
        for (const { page } of [first, second]) {
          await expect(occurrence(page)).toHaveCount(1);
          await expect(occurrence(page)).toContainText(expectedTitle);
        }
        const warning = resolver.page.locator('banner', {
          hasText: /Older edits may have been discarded/,
        });
        if (scenario === 'different title') {
          await expect(warning).toBeVisible();
          await expect(warning).toContainText(DISCARDED_TITLE);
        } else {
          await expect(warning).toHaveCount(0);
        }
      } finally {
        await closeContextsSafely(...contexts);
      }
    });
  }
});
