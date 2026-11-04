import type { Browser } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  getStoreCounterByTitle,
  readStoreCounterEntity,
  readStoreCounters,
  type StoreCounter,
} from '../../utils/audit-concurrency-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync regression test for issue #7330 (recurrence on SIMPLE_COUNTER).
 *
 * Scenario from ruckusvol's logs (both devices ≥ v18.6.0): a simple counter is
 * deleted on one device while it is concurrently incremented on another. The
 * LWW rule resurrects the counter (update wins over a concurrent delete —
 * `suggestConflictResolution` returns 'remote' for local-delete-vs-remote-
 * update), so the deleting client recreates the entity from its `{id}`-only
 * delete payload. Before the fix that recreated counter was missing required
 * fields — most often `type`, which typia rejects and dataRepair could not
 * heal — so the deleting client dead-ended on a native "Data Cleanup Needed" /
 * "Repair attempted but failed" dialog after every sync.
 *
 * The dialog assertions fail without the RECREATE_FALLBACK +
 * auto-fix-typia-errors changes. The entity comparison (#11465) fails while the
 * deleting client recreates the counter from an `{id}`-only delete payload: it
 * ends with a blank, disabled counter while the other client keeps the real one.
 * Both arrival orders are covered so convergence holds in both conflict
 * directions.
 *
 * NOTE: the data-damage prompts are NATIVE confirm()/alert() dialogs. The
 * default E2E handler only auto-dismisses devError dialogs, so this test
 * attaches its own listener to capture (and dismiss, to avoid a hang) any
 * repair/cleanup dialog and assert none fired.
 */

const REPAIR_DIALOG_RE =
  /Repair attempted but failed|Data Cleanup Needed|automatic cleanup|references are inconsistent/i;

/**
 * Captures native data-repair/cleanup dialogs for one client. Returns the
 * collected messages array (asserted empty after sync convergence). Dismisses
 * the dialog so the blocked page can continue instead of hanging the test.
 */
const captureRepairDialogs = (client: SimulatedE2EClient): string[] => {
  const messages: string[] = [];
  client.page.on('dialog', async (dialog) => {
    if (!REPAIR_DIALOG_RE.test(dialog.message())) {
      // Not ours (e.g. a devError dialog handled by the default listener).
      return;
    }
    messages.push(dialog.message());
    try {
      await dialog.dismiss();
    } catch {
      // Already handled by another listener — ignore.
    }
  });
  return messages;
};

const createCounter = async (
  client: SimulatedE2EClient,
  title: string,
  typeLabel: 'Click Counter' | 'Stopwatch' = 'Click Counter',
): Promise<void> => {
  await client.page.goto('/#/habits');
  await client.page.waitForURL(/habits/);

  const addBtn = client.page.locator('.add-habit-btn');
  await addBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addBtn.click();

  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  const titleInput = dialog.locator('formly-form input').first();
  await titleInput.waitFor({ state: 'visible', timeout: 5000 });
  await titleInput.fill(title);

  const typeSelect = dialog.locator('mat-select').first();
  await typeSelect.waitFor({ state: 'visible', timeout: 5000 });
  await typeSelect.click();
  await client.page.locator(`mat-option:has-text("${typeLabel}")`).click();
  if (typeLabel === 'Stopwatch') {
    // Streaks would require a daily time goal; the type is all this needs.
    await dialog.getByRole('switch', { name: 'Track streaks' }).click();
  }

  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });

  await client.page.goto('/#/tag/TODAY/tasks');
  await client.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

/** Increment the (single) click counter shown in the header by one. */
const incrementCounter = async (client: SimulatedE2EClient): Promise<void> => {
  // The action row scrolls when the header is narrow (#9480), so the counter
  // may sit past the trailing edge — Playwright scrolls it back into view as
  // part of the click's actionability check.
  const counter = client.page
    .locator('.counters-action-group simple-counter-button')
    .first();
  await counter.waitFor({ state: 'visible', timeout: 15000 });
  await counter.locator('.main-btn').click();
};

/** Delete the counter titled `title` via its edit-settings dialog. */
const deleteCounter = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  await client.page.goto('/#/habits');
  await client.page.waitForURL(/habits/);

  const habitTitle = client.page.locator('.habit-title', { hasText: title }).first();
  await habitTitle.waitFor({ state: 'visible', timeout: 10000 });
  await habitTitle.click();

  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  // Not `.first()`: Delete renders after the dialog appears, so the first
  // action button can still be Cancel, which closes the dialog.
  await dialog.locator('mat-dialog-actions button[color="warn"]').click();

  const confirmBtn = client.page.locator('dialog-confirm button[e2e="confirmBtn"]');
  await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
  await confirmBtn.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });

  await client.page.goto('/#/tag/TODAY/tasks');
  await client.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

/** Rename the counter titled `title` via its edit-settings dialog. */
const renameCounter = async (
  client: SimulatedE2EClient,
  title: string,
  newTitle: string,
): Promise<void> => {
  await client.page.goto('/#/habits');
  await client.page.waitForURL(/habits/);

  const habitTitle = client.page.locator('.habit-title', { hasText: title }).first();
  await habitTitle.waitFor({ state: 'visible', timeout: 10000 });
  await habitTitle.click();

  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  const titleInput = dialog.locator('formly-form input').first();
  await titleInput.waitFor({ state: 'visible', timeout: 5000 });
  await titleInput.fill(newTitle);
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });

  await client.page.goto('/#/tag/TODAY/tasks');
  await client.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

/** Reload the app and wait until it is ready again (rehydrates from the op log). */
const reloadClient = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(client.page);
};

/**
 * The persisted counter without the fields that are legitimately per device:
 * `isOn` (a stopwatch's running state is local and reset on load) and
 * `modified` (stamped with local time when an LWW Update is applied).
 */
const persistedCounter = async (
  client: SimulatedE2EClient,
  id: string,
): Promise<Record<string, unknown> | null> => {
  const entity = await readStoreCounterEntity(client, id);
  if (!entity) return null;
  const rest = { ...entity };
  delete rest['isOn'];
  delete rest['modified'];
  return rest;
};

/** Number of counters visible in the header on this client. */
const counterCount = async (client: SimulatedE2EClient): Promise<number> => {
  await client.page.waitForTimeout(500);
  return client.page.locator('.counters-action-group simple-counter-button').count();
};

/**
 * Which device's concurrent edit reaches the server first.
 * - `update-first`: A pulls B's update while holding its own unsynced delete,
 *   so A resolves local-DELETE vs remote-UPDATE (remote wins) and recreates the
 *   counter from its delete payload plus B's update (#11465).
 * - `delete-first`: B pulls A's delete while holding its own unsynced update,
 *   so B resolves local-UPDATE vs remote-DELETE (local wins) and A recreates
 *   the counter from B's re-uploaded winning state.
 */
type ArrivalOrder = 'update-first' | 'delete-first';

const runDeleteVsUpdate = async (
  {
    browser,
    baseURL,
    testRunId,
  }: {
    browser: Browser;
    baseURL: string | undefined;
    testRunId: string;
  },
  order: ArrivalOrder,
): Promise<void> => {
  const counterTitle = `C7330-${order}-${Date.now()}`;
  let clientA: SimulatedE2EClient | null = null;
  let clientB: SimulatedE2EClient | null = null;
  let clientC: SimulatedE2EClient | null = null;

  try {
    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

    // ===== Phase 1: A creates + seeds the counter, syncs to server =====
    clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
    const repairDialogsA = captureRepairDialogs(clientA);
    await clientA.sync.setupSuperSync(syncConfig);

    await createCounter(clientA, counterTitle);
    await incrementCounter(clientA);
    await clientA.sync.syncAndWait();

    // ===== Phase 2: B downloads the counter =====
    clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
    const repairDialogsB = captureRepairDialogs(clientB);
    await clientB.sync.setupSuperSync(syncConfig);
    await clientB.sync.syncAndWait();
    expect(await counterCount(clientB)).toBe(1);
    const counterId = (await getStoreCounterByTitle(clientA, counterTitle))?.id;
    expect(counterId).toBeTruthy();

    // ===== Phase 3: concurrent edits (offline) =====
    // A deletes the counter; B increments it. Neither has synced yet.
    await deleteCounter(clientA, counterTitle);
    await incrementCounter(clientB);

    // ===== Phase 4: exchange in the chosen arrival order =====
    if (order === 'update-first') {
      // A resolves local-DELETE vs remote-UPDATE → remote wins → A recreates
      // the counter from its delete payload plus B's update.
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
    } else {
      // B resolves local-UPDATE vs remote-DELETE → local wins → B re-uploads
      // the counter; A recreates it from B's winning state.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
    }
    await clientB.sync.syncAndWait();
    await clientA.sync.syncAndWait();

    // ===== Phase 5: assertions =====
    // No native data-repair/cleanup dialog fired (the original #7330 net).
    expect(repairDialogsA).toEqual([]);
    expect(repairDialogsB).toEqual([]);

    // Update wins over a concurrent delete, so the counter must exist on both
    // clients as the same entity: same title, type, enabled state and per-day
    // counts (#11465). A blank, disabled shell on the deleting client is a
    // permanent divergence.
    const comparable = (c: StoreCounter | null): Omit<StoreCounter, 'id'> | null =>
      c && {
        title: c.title,
        type: c.type,
        isEnabled: c.isEnabled,
        countOnDay: c.countOnDay,
      };
    // By id: a counter resurrected from an {id}-only payload may lack its title.
    const byId = async (client: SimulatedE2EClient): Promise<StoreCounter | null> =>
      (await readStoreCounters(client)).find((c) => c.id === counterId) ?? null;
    await expect
      .poll(async () => comparable(await byId(clientB!)))
      .toEqual(expect.objectContaining({ title: counterTitle, type: 'ClickCounter' }));
    const counterA = comparable(await byId(clientA));
    const counterB = comparable(await byId(clientB));
    // Test-generated title and counts only; no user content.
    console.log(`[7330 ${order}] counter A:`, JSON.stringify(counterA));
    console.log(`[7330 ${order}] counter B:`, JSON.stringify(counterB));
    expect(counterA).toEqual(counterB);
    expect(counterB?.isEnabled).toBe(true);
    expect(Object.values(counterB?.countOnDay ?? {})).toEqual([2]);
    expect(await counterCount(clientB)).toBe(1);
    expect(await counterCount(clientA)).toBe(1);

    // ===== Phase 6: whole entity, after reload and on a fresh client =====
    // A reloads (rehydrates from its own op log) and a fresh client C builds
    // the counter from the server alone. All three must hold the same
    // persisted counter, every field except the per-device `isOn`/`modified`.
    await reloadClient(clientA);
    clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
    const repairDialogsC = captureRepairDialogs(clientC);
    await clientC.sync.setupSuperSync(syncConfig);
    await clientC.sync.syncAndWait();

    const wholeA = await persistedCounter(clientA, counterId!);
    const wholeB = await persistedCounter(clientB, counterId!);
    const wholeC = await persistedCounter(clientC, counterId!);
    console.log(`[7330 ${order}] whole A:`, JSON.stringify(wholeA));
    console.log(`[7330 ${order}] whole B:`, JSON.stringify(wholeB));
    console.log(`[7330 ${order}] whole C:`, JSON.stringify(wholeC));
    expect(wholeB).not.toBeNull();
    expect(wholeA).toEqual(wholeB);
    expect(wholeC).toEqual(wholeB);
    expect(repairDialogsA).toEqual([]);
    expect(repairDialogsC).toEqual([]);
  } finally {
    if (clientA) await closeClient(clientA);
    if (clientB) await closeClient(clientB);
    if (clientC) await closeClient(clientC);
  }
};

/**
 * A deletes a RUNNING stopwatch while B renames it; B's update reaches the
 * server first, so A loses and recreates the counter from its delete snapshot.
 *
 * PINS CURRENT BEHAVIOUR (follow-up issue: flush the stopwatch before clearing
 * it on delete). `deleteSimpleCounter` clears the stopwatch accumulator
 * without flushing it, and the snapshot is taken while the stopwatch runs, so
 * on A the recreated counter comes back running (`isOn: true`) and carries the
 * locally ticked time that never reached the server; B never sees that time.
 */
const runDeleteRunningStopwatch = async ({
  browser,
  baseURL,
  testRunId,
}: {
  browser: Browser;
  baseURL: string | undefined;
  testRunId: string;
}): Promise<void> => {
  const counterTitle = `C7330-stopwatch-${Date.now()}`;
  const renamedTitle = `${counterTitle}-renamed`;
  let clientA: SimulatedE2EClient | null = null;
  let clientB: SimulatedE2EClient | null = null;

  try {
    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

    clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
    const repairDialogsA = captureRepairDialogs(clientA);
    await clientA.sync.setupSuperSync(syncConfig);
    await createCounter(clientA, counterTitle, 'Stopwatch');
    await clientA.sync.syncAndWait();

    clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
    const repairDialogsB = captureRepairDialogs(clientB);
    await clientB.sync.setupSuperSync(syncConfig);
    await clientB.sync.syncAndWait();
    const counterId = (await getStoreCounterByTitle(clientA, counterTitle))?.id;
    expect(counterId).toBeTruthy();

    // A starts the stopwatch and lets it tick: the elapsed time is the point.
    await incrementCounter(clientA);
    await expect
      .poll(async () => (await readStoreCounterEntity(clientA!, counterId!))?.['isOn'])
      .toBe(true);
    await clientA.page.waitForTimeout(3000);
    const runningA = await readStoreCounterEntity(clientA, counterId!);
    console.log('[7330 stopwatch] A before delete:', JSON.stringify(runningA));

    // Concurrent, offline: A deletes the running stopwatch, B renames it.
    await deleteCounter(clientA, counterTitle);
    await renameCounter(clientB, counterTitle, renamedTitle);

    // B's update reaches the server first; A loses its delete and recreates.
    await clientB.sync.syncAndWait();
    await clientA.sync.syncAndWait();
    await clientB.sync.syncAndWait();
    await clientA.sync.syncAndWait();

    expect(repairDialogsA).toEqual([]);
    expect(repairDialogsB).toEqual([]);

    const recreatedA = await readStoreCounterEntity(clientA, counterId!);
    const counterB = await readStoreCounterEntity(clientB, counterId!);
    console.log('[7330 stopwatch] A after sync:', JSON.stringify(recreatedA));
    console.log('[7330 stopwatch] B after sync:', JSON.stringify(counterB));

    // Converged: the counter exists on both with B's title and A's type.
    expect(recreatedA?.['title']).toBe(renamedTitle);
    expect(counterB?.['title']).toBe(renamedTitle);
    expect(recreatedA?.['type']).toBe('StopWatch');
    expect(counterB?.['type']).toBe('StopWatch');

    // Pinned current behaviour (see the docblock): A's counter comes back
    // running, with the unsynced time A ticked before the delete; B has none.
    const daySum = (c: Record<string, unknown> | null): number =>
      Object.values(
        (c?.['countOnDay'] as Record<string, number> | undefined) ?? {},
      ).reduce((sum, v) => sum + v, 0);
    expect(recreatedA?.['isOn']).toBe(true);
    expect(daySum(recreatedA)).toBeGreaterThan(0);
    expect(daySum(counterB)).toBe(0);
  } finally {
    if (clientA) await closeClient(clientA);
    if (clientB) await closeClient(clientB);
  }
};

test.describe('@supersync Simple Counter delete-vs-update (#7330, #11465)', () => {
  test('update reaches the server first: the deleting client adopts the full counter', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    await runDeleteVsUpdate({ browser, baseURL, testRunId }, 'update-first');
  });

  test('delete reaches the server first: the deleting client adopts the full counter', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    await runDeleteVsUpdate({ browser, baseURL, testRunId }, 'delete-first');
  });

  test('a running stopwatch deleted while renamed elsewhere comes back running on the deleting client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    await runDeleteRunningStopwatch({ browser, baseURL, testRunId });
  });
});
