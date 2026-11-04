import type { Browser } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

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

/** A simple counter as the live store holds it. */
interface StoreCounter {
  id: string;
  title: string;
  type: string | null;
  isEnabled: boolean | null;
  countOnDay: Record<string, number>;
}

/** Every simple counter in the live NgRx store (read synchronously). */
const readStoreCounters = async (client: SimulatedE2EClient): Promise<StoreCounter[]> =>
  client.page.evaluate(() => {
    type Slice = { entities?: Record<string, Record<string, unknown>> };
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: {
            subscribe: (fn: (s: { simpleCounter?: Slice }) => void) => {
              unsubscribe: () => void;
            };
          };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('window.__e2eTestHelpers.store is not available');
    }
    let root: { simpleCounter?: Slice } | undefined;
    store.subscribe((s) => (root = s)).unsubscribe();
    return Object.values(root?.simpleCounter?.entities ?? {}).map((c) => ({
      id: String(c.id),
      title: String(c.title),
      type: typeof c.type === 'string' ? c.type : null,
      isEnabled: typeof c.isEnabled === 'boolean' ? c.isEnabled : null,
      countOnDay:
        typeof c.countOnDay === 'object' && c.countOnDay !== null
          ? (c.countOnDay as Record<string, number>)
          : {},
    }));
  });

const getStoreCounterByTitle = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<StoreCounter | null> =>
  (await readStoreCounters(client)).find((c) => c.title === title) ?? null;

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

const createClickCounter = async (
  client: SimulatedE2EClient,
  title: string,
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
  await client.page.locator('mat-option:has-text("Click Counter")').click();

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

  try {
    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

    // ===== Phase 1: A creates + seeds the counter, syncs to server =====
    clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
    const repairDialogsA = captureRepairDialogs(clientA);
    await clientA.sync.setupSuperSync(syncConfig);

    await createClickCounter(clientA, counterTitle);
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
});
