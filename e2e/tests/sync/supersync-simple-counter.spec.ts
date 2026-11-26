import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { getStoreCounterByTitle } from '../../utils/audit-concurrency-helpers';

/**
 * SuperSync Simple Counter E2E Tests
 *
 * Tests that simple counters (click counters and stopwatch counters)
 * sync correctly between clients using absolute values.
 */

/**
 * Helper to navigate to settings and create a simple counter
 */
const createSimpleCounter = async (
  client: SimulatedE2EClient,
  title: string,
  type: 'click' | 'stopwatch',
): Promise<void> => {
  // Navigate to the habits page
  await client.page.goto('/#/habits');
  await client.page.waitForURL(/habits/);
  await client.page.waitForTimeout(500);

  // Click "Add habit" button
  const addBtn = client.page.locator('.add-habit-btn');
  await addBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addBtn.click();

  // Wait for the edit dialog to appear
  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Fill title input (first input in the formly form)
  const titleInput = dialog.locator('formly-form input').first();
  await titleInput.waitFor({ state: 'visible', timeout: 5000 });
  await titleInput.fill(title);

  // Select counter type from mat-select
  const typeSelect = dialog.locator('mat-select').first();
  await typeSelect.waitFor({ state: 'visible', timeout: 5000 });
  // Wait for dialog animation to settle before interacting
  await client.page.waitForTimeout(500);
  await typeSelect.click();
  await client.page.waitForTimeout(300);
  const typeOption = client.page.locator(
    `mat-option:has-text("${type === 'click' ? 'Click Counter' : 'Stopwatch'}")`,
  );
  await typeOption.click();
  await client.page.waitForTimeout(300);

  // Click Save button
  const saveBtn = dialog.locator('button[type="submit"]');
  await saveBtn.click();

  // Wait for dialog to close
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  await client.page.waitForTimeout(500);

  // Navigate back to work view
  await client.page.goto('/#/tag/TODAY/tasks');
  await client.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
  await client.page.waitForTimeout(500);
};

/**
 * Counters always render inline in `.counters-action-group`; when the header is
 * narrow the row scrolls rather than moving them anywhere (#9480), and
 * Playwright's actionability scroll brings one back into view on click.
 */
const ensureCountersVisible = async (client: SimulatedE2EClient): Promise<void> => {
  await (await getVisibleCounters(client))
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
};

const getVisibleCounters = async (
  client: SimulatedE2EClient,
): Promise<ReturnType<typeof client.page.locator>> =>
  client.page.locator('.counters-action-group simple-counter-button');

/**
 * Helper to get the counter value from the header.
 * Ensures counters are visible, then reads the `.label` text from the last counter button.
 */
const getCounterValue = async (client: SimulatedE2EClient): Promise<string> => {
  await client.page.waitForTimeout(500);
  await ensureCountersVisible(client);

  const allCounters = await getVisibleCounters(client);
  const count = await allCounters.count();
  console.log(`Found ${count} simple counter buttons`);

  if (count > 0) {
    const lastCounter = allCounters.last();
    const label = lastCounter.locator('.label');
    if (await label.isVisible()) {
      return (await label.textContent()) || '0';
    }
    return '0';
  }
  return '0';
};

/**
 * Helper to increment a click counter.
 * Ensures counters are visible, then clicks the `.main-btn` of the last counter.
 */
const incrementClickCounter = async (client: SimulatedE2EClient): Promise<void> => {
  await ensureCountersVisible(client);

  const allCounters = await getVisibleCounters(client);
  const lastCounter = allCounters.last();
  await lastCounter.locator('.main-btn').click();
};

test.describe('@supersync Simple Counter Sync', () => {
  /**
   * Scenario: Click counter syncs with absolute value
   *
   * This tests the fix where click counters now sync immediately
   * with absolute values instead of being batched.
   *
   * Actions:
   * 1. Client A creates a click counter
   * 2. Client A increments it 3 times
   * 3. Client A syncs
   * 4. Client B syncs
   * 5. Verify Client B sees the same value (3)
   */
  test('Click counter syncs correctly between clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    const counterTitle = `ClickTest-${uniqueId}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Setup & Increment ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create click counter
      await createSimpleCounter(clientA, counterTitle, 'click');

      // Wait for counter to appear
      await clientA.page.waitForTimeout(500);

      // Increment 3 times
      for (let i = 0; i < 3; i++) {
        await incrementClickCounter(clientA);
        await clientA.page.waitForTimeout(200);
      }

      // Verify Client A shows 3
      const valueA = await getCounterValue(clientA);
      expect(valueA).toBe('3');
      console.log(`Client A counter value: ${valueA}`);

      // Sync A
      await clientA.sync.syncAndWait();
      console.log('Client A synced.');

      // ============ PHASE 2: Client B Sync & Verify ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Sync B
      await clientB.sync.syncAndWait();
      console.log('Client B synced.');

      // Wait for UI to update
      await clientB.page.waitForTimeout(1000);

      // Verify Client B sees the same value
      const valueB = await getCounterValue(clientB);
      console.log(`Client B counter value: ${valueB}`);
      expect(valueB).toBe('3');

      console.log('✓ Click counter sync verification passed!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Concurrent increments converge on the later writer's value
   *
   * An increment is captured as an absolute set of today's count, not as a
   * delta, so concurrent increments on two clients cannot add up: every client
   * must end with the later writer's value, and none may show 0.
   *
   * Actions:
   * 1. A creates a click counter (0), syncs; B downloads it
   * 2. A increments twice (A: 2), B increments once later (B: 1), no sync between
   * 3. Sync A, B, A; then a fresh C joins
   * 4. Verify A, B and C all hold 1 (B's later absolute write) in store and header
   */
  test('Concurrent click counter increments converge on the later write', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    const counterTitle = `MultiClientClick-${uniqueId}`;
    const clients: SimulatedE2EClient[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await createSimpleCounter(clientA, counterTitle, 'click');
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await expect
        .poll(async () => (await getStoreCounterByTitle(clientB, counterTitle))?.id)
        .toBe((await getStoreCounterByTitle(clientA, counterTitle))?.id);

      // ============ Concurrent increments, no sync in between ============
      await incrementClickCounter(clientA);
      await clientA.page.waitForTimeout(200);
      await incrementClickCounter(clientA);
      expect(await getCounterValue(clientA)).toBe('2');

      await clientB.page.waitForTimeout(1000);
      await incrementClickCounter(clientB);
      expect(await getCounterValue(clientB)).toBe('1');

      // ============ Sync A, B, A; then C joins ============
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      for (const client of clients) {
        await expect
          .poll(async () =>
            Object.values(
              (await getStoreCounterByTitle(client, counterTitle))?.countOnDay ?? {},
            ),
          )
          .toEqual([1]);
        expect(await getCounterValue(client)).toBe('1');
      }
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
