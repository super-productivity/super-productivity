import type { Store } from '@ngrx/store';
import type { Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

/**
 * The add-task bar parses the input after every change. The first `@date` of a
 * page load waits for the lazy date-parser chunk, so Enter can come before the
 * parse of the current input has landed, while the bar still holds the result
 * of an earlier draft. Enter must wait for the parse of the submitted text and
 * create the task from it.
 *
 * Run: npm run e2e:file e2e/tests/task-basic/add-bar-stale-title.spec.ts -- --retries=0
 */

type TaskSummary = {
  id: string;
  title: string;
  dueDay?: string | null;
  timeEstimate: number;
};

const readTasks = (page: Page): Promise<TaskSummary[]> =>
  page.evaluate(() => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let state: RootState | undefined;
    store.subscribe((value) => (state = value)).unsubscribe();
    return Object.values(state?.tasks.entities ?? {}).map((task) => ({
      id: task!.id,
      title: task!.title,
      dueDay: task!.dueDay,
      timeEstimate: task!.timeEstimate,
    }));
  });

const readTitles = async (page: Page): Promise<string[]> =>
  (await readTasks(page)).map(({ title }) => title);

/** Action codes of the local ops persisted for a task, oldest first. */
const readTaskOpCodes = (page: Page, taskId: string): Promise<string[]> =>
  page.evaluate(async (id) => {
    type StoredEntry = {
      seq: number;
      source: string;
      op: { a: string; d?: string; ds?: string[] };
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error);
    });
    try {
      const entries = await new Promise<StoredEntry[]>((resolve, reject) => {
        const request = db.transaction('ops', 'readonly').objectStore('ops').getAll();
        request.onsuccess = (): void => resolve(request.result as StoredEntry[]);
        request.onerror = (): void => reject(request.error);
      });
      return entries
        .filter(
          ({ source, op }) =>
            source === 'local' && (op.d === id || !!op.ds?.includes(id)),
        )
        .sort((a, b) => a.seq - b.seq)
        .map(({ op }) => op.a);
    } finally {
      db.close();
    }
  }, taskId);

/**
 * Holds every script requested from now on, such as the date-parser chunk,
 * until `release()`, so the race cannot disappear on a faster machine. No
 * parser result is stubbed.
 */
const holdScripts = async (
  page: Page,
): Promise<{ heldCount: () => number; release: () => void }> => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let heldCount = 0;
  await page.route(/\.js(?:\?|$)/, async (route) => {
    heldCount++;
    await gate;
    await route.continue();
  });
  return { heldCount: () => heldCount, release };
};

const localDay = (page: Page, offsetDays: number): Promise<string> =>
  page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }, offsetDays);

test('a task added while the date parser loads gets the parse of its own text in one op', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await page.locator('.tour-addBtn').click();
  const input = page.locator('add-task-bar.global .main-input');
  // An earlier draft whose parse lands first, so the bar holds its title and
  // its estimate when Enter comes.
  await input.fill('Cold parser base 10m');
  await expect(page.locator('add-task-bar.global .syntax-highlight')).toHaveText(['10m']);

  const scripts = await holdScripts(page);
  try {
    await input.fill('Cold parser base @tomorrow suffix');
    await expect.poll(scripts.heldCount).toBeGreaterThan(0);
    await input.press('Enter');
    expect(await readTasks(page)).toEqual([]);
  } finally {
    scripts.release();
  }

  // Removing `@tomorrow` leaves both spaces around it.
  const expected = {
    title: 'Cold parser base  suffix',
    dueDay: await localDay(page, 1),
    timeEstimate: 0,
  };
  await expect.poll(() => readTasks(page)).toEqual([expect.objectContaining(expected)]);
  const [task] = await readTasks(page);
  await flushPendingWrites(page);
  // The add carries the parsed fields, so short syntax has nothing left to fix.
  expect(await readTaskOpCodes(page, task.id)).toEqual(['HA']);
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect.poll(() => readTasks(page)).toEqual([expect.objectContaining(expected)]);
});

test('closing the bar while the date parser loads drops the submit', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await page.locator('.tour-addBtn').click();
  const bar = page.locator('add-task-bar.global');
  const input = bar.locator('.main-input');
  const draft = 'Closed draft @tomorrow suffix';

  const scripts = await holdScripts(page);
  try {
    await input.fill(draft);
    await expect.poll(scripts.heldCount).toBeGreaterThan(0);
    await input.press('Enter');
    await input.press('Escape');
    await expect(bar).toHaveCount(0);
  } finally {
    scripts.release();
  }

  // The reopened bar restores the draft. Once its date has been parsed, the
  // chunk the dropped submit waited for has arrived.
  await page.locator('.tour-addBtn').click();
  await expect(input).toHaveValue(draft);
  await expect(bar.locator('.syntax-highlight')).toHaveText(['@tomorrow']);
  expect(await readTitles(page)).toEqual([]);
});

for (const edit of ['unchanged', 'date', 'plain'] as const) {
  test(`a menu repeat added while the date parser loads gets a clean template (${edit})`, async ({
    page,
    workViewPage,
  }) => {
    // Keep the first occurrence in the future so overdue cleanup cannot move it.
    const dueDay = `${new Date().getFullYear() + 1}-12-01`;
    await workViewPage.waitForTaskList();
    await page.locator('.tour-addBtn').click();
    const input = page.locator('add-task-bar.global .main-input');
    await input.fill('Draft');
    await page.locator('[data-test="add-task-bar-repeat-btn"]').click();
    await page.getByRole('menuitem', { name: 'Every day', exact: true }).click();
    await expect(input).toBeFocused();

    const scripts = await holdScripts(page);
    try {
      await input.fill(`Draft @${dueDay} suffix`);
      await expect.poll(scripts.heldCount).toBeGreaterThan(0);
      await input.press('Enter');
      expect(await readTitles(page)).toEqual([]);
      if (edit === 'date') {
        // Deliver the edit and both Enters in one turn, before inputTxt$ hands
        // the new draft to the parser.
        await input.evaluate(
          (element, text) => {
            (element as HTMLTextAreaElement).value = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            for (let i = 0; i < 2; i++) {
              element.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: 'Enter',
                  bubbles: true,
                  cancelable: true,
                }),
              );
            }
          },
          `Latest @${dueDay.slice(0, -2)}02 words`,
        );
      } else if (edit === 'plain') {
        await input.fill('Latest words');
        await input.press('Enter');
        // Repeated Enter for the same draft must not create a second task.
        await input.press('Enter');
        // A parse that does not need the held chunk lands, and the dropped
        // submit for the earlier draft does not hold this one back.
        await expect.poll(() => readTitles(page)).toEqual(['Latest words']);
      }
    } finally {
      scripts.release();
    }

    const readRepeat = (): Promise<{
      title?: string;
      dueDay?: string | null;
      templateTitle?: string;
      startDate?: string;
      templateCount: number;
    }> =>
      page.evaluate(() => {
        type RepeatState = RootState & {
          taskRepeatCfg: {
            entities: Record<string, { title: string; startDate: string }>;
          };
        };
        const store = (
          window as Window & { __e2eTestHelpers: { store: Store<RepeatState> } }
        ).__e2eTestHelpers.store;
        let state: RepeatState | undefined;
        store.subscribe((value) => (state = value)).unsubscribe();
        const task = Object.values(state?.tasks.entities ?? {})[0];
        const cfg = task?.repeatCfgId
          ? state?.taskRepeatCfg.entities[task.repeatCfgId]
          : undefined;
        return {
          title: task?.title,
          dueDay: task?.dueDay,
          templateTitle: cfg?.title,
          startDate: cfg?.startDate,
          templateCount: Object.keys(state?.taskRepeatCfg.entities ?? {}).length,
        };
      });
    const expectedTitle =
      edit === 'unchanged'
        ? 'Draft  suffix'
        : edit === 'date'
          ? 'Latest  words'
          : 'Latest words';
    const expectedDay =
      edit === 'plain'
        ? await localDay(page, 0)
        : edit === 'date'
          ? `${dueDay.slice(0, -2)}02`
          : dueDay;
    const expected = {
      title: expectedTitle,
      dueDay: expectedDay,
      templateTitle: expectedTitle,
      startDate: expectedDay,
      templateCount: 1,
    };
    await expect.poll(() => readTitles(page)).toEqual([expectedTitle]);
    await expect.poll(readRepeat).toEqual(expected);
    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect.poll(readRepeat).toEqual(expected);
  });
}
