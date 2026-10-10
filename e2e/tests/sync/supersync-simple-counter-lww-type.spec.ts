import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';

/**
 * A concurrent habit edit whose LOCAL side wins produces a whole-habit
 * `[SIMPLE_COUNTER] LWW Update`. The flat action envelope cannot carry the
 * habit's own `type` field (the action `type` shadows it), so a receiver that
 * replaced the habit with that snapshot lost `type` — a Stopwatch habit fell
 * back to a click counter on the other device — and a receiver that kept its
 * own `type` diverged from the winner.
 */

type HabitTypeLabel = 'Stopwatch' | 'Click counter';

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

const selectHabitType = async (
  client: SimulatedE2EClient,
  dialog: Locator,
  typeLabel: HabitTypeLabel,
): Promise<void> => {
  await dialog.locator('mat-select').first().click();
  await client.page.locator('mat-option', { hasText: typeLabel }).click();
};

const createHabit = async (
  client: SimulatedE2EClient,
  title: string,
  typeLabel: HabitTypeLabel,
): Promise<void> => {
  await client.page.goto('/#/habits');
  await client.page.locator('.add-habit-btn').click();
  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await dialog.locator('formly-form input').first().fill(title);
  await selectHabitType(client, dialog, typeLabel);
  // Streaks would require a daily time goal; the type is all this test needs.
  await dialog.getByRole('switch', { name: 'Track streaks' }).click();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
};

/** Saves the whole settings form, as the UI does for every habit edit. */
const editHabit = async (
  client: SimulatedE2EClient,
  title: string,
  edit: { title?: string; typeLabel?: HabitTypeLabel },
): Promise<void> => {
  const dialog = await openHabitSettings(client, title);
  if (edit.title) await dialog.locator('formly-form input').first().fill(edit.title);
  if (edit.typeLabel) await selectHabitType(client, dialog, edit.typeLabel);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
};

const renameHabit = (
  client: SimulatedE2EClient,
  from: string,
  to: string,
): Promise<void> => editHabit(client, from, { title: to });

/** Released bundles expose no test store: read the type from the settings form. */
const readHabitTypeInUi = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<string> => {
  const dialog = await openHabitSettings(client, title);
  const value = dialog
    .locator('mat-select')
    .first()
    .locator('.mat-mdc-select-value-text');
  const label = ((await value.textContent()) ?? '').trim();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  return label;
};

/**
 * Real download, then fail on a sync error or the whole-dataset dialog:
 * `syncAndWait()` would silently pick a side and hide a divergence.
 */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (r) => r.url().includes('/api/sync/ops') && r.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  let outcome = 'pending';
  await expect
    .poll(
      async () => {
        outcome = (await client.sync.conflictDialog.isVisible())
          ? 'conflict-dialog'
          : (await client.sync.hasSyncError())
            ? 'error'
            : !(await client.sync.syncSpinner.isVisible()) &&
                (await client.sync.syncConfirmedIcon.isVisible())
              ? 'in-sync'
              : 'pending';
        return outcome;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  expect(outcome).toBe('in-sync');
};

/** REPAIR / import rows: a validation repair after the LWW apply writes one. */
const fullStateOpCount = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const rows = await new Promise<{ op: { o: string } }[]>((resolve, reject) => {
        const r = db.transaction('ops').objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return rows.filter((row) =>
        ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(row.op.o),
      ).length;
    } finally {
      db.close();
    }
  });

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
      await createHabit(a, title, 'Stopwatch');
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

  // The winner's snapshot carries its own type. A receiver that kept its
  // existing type instead (the envelope shadows the field) silently diverged
  // whenever the two devices' types differed.
  for (const typeChangedBy of ['losing', 'winning'] as const) {
    test(`both devices converge on the winner's type when the ${typeChangedBy} edit changed it`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      const title = `Habit-${testRunId}`;
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clients.push(a);
        await a.sync.setupSuperSync(config);
        await createHabit(a, title, 'Click counter');
        await sync(a);

        const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        clients.push(b);
        await b.sync.setupSuperSync(config);
        await sync(b);
        expect(await readHabits(b.page, title)).toEqual([
          { title, type: 'ClickCounter' },
        ]);
        const fullStateOpsBefore = [
          await fullStateOpCount(a.page),
          await fullStateOpCount(b.page),
        ];

        // B's edit reaches the server first; A's later edit of the whole
        // settings form wins the conflict and A uploads its habit snapshot.
        let expected: { title: string; type: string }[];
        if (typeChangedBy === 'losing') {
          await editHabit(b, title, { typeLabel: 'Stopwatch' });
          await sync(b);
          await editHabit(a, title, { title: `${title}-A` });
          expected = [{ title: `${title}-A`, type: 'ClickCounter' }];
        } else {
          await editHabit(b, title, { title: `${title}-B` });
          await sync(b);
          await editHabit(a, title, { typeLabel: 'Stopwatch' });
          expected = [{ title, type: 'StopWatch' }];
        }
        await sync(a);
        await sync(b);

        expect(await readHabits(a.page, title)).toEqual(expected);
        expect(await readHabits(b.page, title)).toEqual(expected);
        expect([await fullStateOpCount(a.page), await fullStateOpCount(b.page)]).toEqual(
          fullStateOpsBefore,
        );
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});

// Supply the untouched released web assets (e.g. the published APK's
// assets/public). v18.15.0-v19.1.0 replace the habit with a 'replace' snapshot
// that cannot carry its type; validation repair then reset it to a click
// counter and wrote a full-state REPAIR op for every device.
test.describe('@supersync released receiver keeps habit type', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  test('a released receiver keeps a Stopwatch habit after a current local-win edit', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const title = `Watch-${testRunId}`;
    const titleA = `${title}-A`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const current = await createSimulatedClient(
        browser,
        baseURL!,
        'Current',
        testRunId,
      );
      clients.push(current);
      await current.sync.setupSuperSync(config);
      await createHabit(current, title, 'Stopwatch');
      await sync(current);

      const released = await createSimulatedClient(
        browser,
        assets.url,
        'Released',
        testRunId,
        { serviceWorkers: 'block' },
      );
      clients.push(released);
      await released.sync.setupSuperSync(config);
      await sync(released);
      expect(await readHabitTypeInUi(released, title)).toBe('Stopwatch');
      const fullStateOpsBefore = [
        await fullStateOpCount(current.page),
        await fullStateOpCount(released.page),
      ];

      // The released rename reaches the server first; the current device's
      // newer rename wins the conflict and it uploads its habit snapshot.
      await renameHabit(released, title, `${title}-B`);
      await sync(released);
      await renameHabit(current, title, titleA);
      await sync(current);
      await sync(released);
      await sync(current);

      expect(await readHabitTypeInUi(released, titleA)).toBe('Stopwatch');
      expect(await readHabits(current.page, title)).toEqual([
        { title: titleA, type: 'StopWatch' },
      ]);
      expect([
        await fullStateOpCount(current.page),
        await fullStateOpCount(released.page),
      ]).toEqual(fullStateOpsBefore);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
