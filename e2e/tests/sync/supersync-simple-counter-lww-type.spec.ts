import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * A concurrent habit edit whose LOCAL side wins produces a whole-habit
 * `[SIMPLE_COUNTER] LWW Update` (replace). The flat action envelope cannot
 * carry the habit's own `type` field (the action `type` shadows it), so a
 * receiver that replaced the habit with that snapshot lost `type` — a
 * Stopwatch habit fell back to a click counter on the other device.
 */

const openHabitSettings = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<Locator> => {
  await client.page.goto('/#/habits');
  await client.page.locator('.habit-title', { hasText: title }).first().click();
  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await expect(dialog).toBeVisible();
  return dialog;
};

const createStopwatchHabit = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  await client.page.goto('/#/habits');
  await client.page.locator('.add-habit-btn').click();
  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await dialog.locator('formly-form input').first().fill(title);
  await dialog.locator('mat-select').first().click();
  await client.page.locator('mat-option', { hasText: 'Stopwatch' }).click();
  // Streaks would require a daily time goal; the type is all this test needs.
  await dialog.getByRole('switch', { name: 'Track streaks' }).click();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
};

const renameHabit = async (
  client: SimulatedE2EClient,
  from: string,
  to: string,
): Promise<void> => {
  const dialog = await openHabitSettings(client, from);
  await dialog.locator('formly-form input').first().fill(to);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
};

/** Title and type of this test's habits (the app also seeds default habits). */
const readHabits = (
  page: Page,
  titlePrefix: string,
): Promise<{ title: string; type: unknown }[]> =>
  page.evaluate((prefix) => {
    type Counter = { title: string; type: unknown };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              next: (s: { simpleCounter: { entities: Record<string, Counter> } }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let counters: Counter[] = [];
    store
      .subscribe((s) => {
        counters = Object.values(s.simpleCounter.entities);
      })
      .unsubscribe();
    return counters
      .filter((c) => c.title.startsWith(prefix))
      .map(({ title, type }) => ({ title, type }));
  }, titlePrefix);

test.describe('@supersync Simple Counter local-win LWW keeps type', () => {
  test('a receiver keeps a Stopwatch habit type after a local-win habit edit', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const title = `Watch-${testRunId}`;
    const titleA = `${title}-A`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(a);
      await a.sync.setupSuperSync(config);
      await createStopwatchHabit(a, title);
      await a.sync.syncAndWait();

      const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(b);
      await b.sync.setupSuperSync(config);
      await b.sync.syncAndWait();
      expect(await readHabits(b.page, title)).toEqual([{ title, type: 'StopWatch' }]);

      // Concurrent renames: B's reaches the server first, A's is newer, so A
      // resolves the conflict as a local win and uploads a whole-habit LWW op.
      await renameHabit(b, title, `${title}-B`);
      await b.sync.syncAndWait();
      await renameHabit(a, title, titleA);
      await a.sync.syncAndWait();
      await b.sync.syncAndWait();

      const expected = [{ title: titleA, type: 'StopWatch' }];
      expect(await readHabits(a.page, title)).toEqual(expected);
      expect(await readHabits(b.page, title)).toEqual(expected);
      expect(await b.sync.hasSyncError()).toBe(false);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
