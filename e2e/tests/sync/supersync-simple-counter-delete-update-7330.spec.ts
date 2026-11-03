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
  readStoreCounters,
  type StoreCounter,
} from '../../utils/audit-concurrency-helpers';

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
 * This test fails (the dialog fires) without the RECREATE_FALLBACK +
 * auto-fix-typia-errors changes and passes with them.
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

test.describe('@supersync Simple Counter delete-vs-update (#7330)', () => {
  test('concurrent delete + update resurrects a valid counter without a repair dialog', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const counterTitle = `C7330-${Date.now()}`;
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

      // ===== Phase 4: B's update reaches the server first, then A pulls it =====
      // This guarantees A resolves local-DELETE vs remote-UPDATE → 'remote'
      // wins → A recreates the counter from its {id}-only delete payload (the
      // exact path that produced `type === undefined` in the report).
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      // A re-uploads the resurrected counter; B converges on it.
      await clientB.sync.syncAndWait();

      // ===== Phase 5: assertions =====
      // THE regression net: NO native data-repair/cleanup dialog fired. Before
      // the fix, A's recreated typeless counter fails post-sync validation and
      // pops the "Data Cleanup Needed" / "Repair attempted but failed" native
      // dialog; with the fix the recreated counter is valid, so nothing fires.
      expect(repairDialogsA).toEqual([]);
      expect(repairDialogsB).toEqual([]);

      // Update wins over a concurrent delete, so the counter must exist on
      // both clients with the same entity: same title, type, enabled state
      // and per-day counts. A counter that one client resurrects as disabled
      // (from its {id}-only delete payload, lww-update.meta-reducer.ts) while
      // the other keeps it enabled is a permanent divergence, not a cosmetic
      // limitation.
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
      console.log('[7330] counter A:', JSON.stringify(counterA));
      console.log('[7330] counter B:', JSON.stringify(counterB));
      expect(counterA).toEqual(counterB);
      expect(counterB?.isEnabled).toBe(true);
      expect(Object.values(counterB?.countOnDay ?? {})).toEqual([2]);
      expect(await counterCount(clientB)).toBe(1);
      expect(await counterCount(clientA)).toBe(1);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
