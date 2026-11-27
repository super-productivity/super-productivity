import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';

// Synthetic addresses: a date word in prose after an email must not turn the
// address's at-sign into scheduling syntax and erase it from the saved title.

type StoredTask = { title: string; dueDay?: string | null; dueWithTime?: number | null };

const readTask = (page: Page, prefix: string): Promise<StoredTask | undefined> =>
  page.evaluate((titlePrefix) => {
    let result: StoredTask | undefined;
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              next: (state: { tasks: { entities: Record<string, StoredTask> } }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    store
      .subscribe((state) => {
        result = Object.values(state.tasks.entities).find((t) =>
          t.title.startsWith(titlePrefix),
        );
      })
      .unsubscribe();
    return result;
  }, prefix);

const setUiLanguage = async (page: Page, lng: string): Promise<void> => {
  await page.evaluate((language) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'localization',
      sectionCfg: { lng: language },
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'localization',
        opType: 'UPD',
      },
    });
  }, lng);
  await waitForStatePersistence(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
};

const CASES: { name: string; lng?: string; text: string }[] = [
  { name: 'the default English UI', text: 'Mail max@example.com tomorrow reply' },
  { name: 'a German UI', lng: 'de', text: 'Mail an max@example.com morgen beantworten' },
  { name: 'a date-word domain', text: 'Mail anna@monday.com reply' },
];

test.describe('Email before a date word', () => {
  for (const { name, lng, text } of CASES) {
    test(`keeps the address and the day with ${name}`, async ({
      page,
      workViewPage,
      testPrefix,
    }) => {
      await workViewPage.waitForTaskList();
      if (lng) {
        await setUiLanguage(page, lng);
        await workViewPage.waitForTaskList();
      }
      const title = `${testPrefix}-${text}`;
      await workViewPage.addTask(title, false, null);

      await expect
        .poll(async () => (await readTask(page, testPrefix))?.title)
        .toBe(title);
      // Added in Today, the task keeps Today's day; the bug moved it to tomorrow.
      const today = await page.evaluate(() => {
        const d = new Date();
        const pad = (n: number): string => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      });
      const task = await readTask(page, testPrefix);
      expect([null, today]).toContain(task?.dueDay ?? null);
      expect(task?.dueWithTime ?? null).toBeNull();

      await waitForStatePersistence(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await workViewPage.waitForTaskList();
      await expect
        .poll(async () => (await readTask(page, testPrefix))?.title)
        .toBe(title);
    });
  }
});
