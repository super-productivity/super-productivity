import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

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
 * Helper to check if the page is in mobile layout.
 * On mobile, counters are behind a `.mobile-dropdown-wrapper` toggle.
 * On desktop (1920x1080), counters are rendered inline in `.counters-action-group`.
 */
const isMobileLayout = async (client: SimulatedE2EClient): Promise<boolean> => {
  return (await client.page.locator('.mobile-dropdown-wrapper').count()) > 0;
};

/**
 * Helper to ensure counters are accessible in the header.
 * On mobile: opens the `.mobile-dropdown` toggle if needed.
 * On desktop: counters are already inline — this is a no-op.
 */
const ensureCountersVisible = async (client: SimulatedE2EClient): Promise<void> => {
  if (!(await isMobileLayout(client))) {
    // Desktop: counters are inline, wait for at least one to appear
    await client.page
      .locator('.counters-action-group simple-counter-button')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
    return;
  }

  // Mobile: open the dropdown if not already open
  const wrapper = client.page.locator('.mobile-dropdown-wrapper');
  await wrapper.waitFor({ state: 'visible', timeout: 15000 });

  const visibleDropdown = client.page.locator('.mobile-dropdown.isVisible');
  if ((await visibleDropdown.count()) > 0) {
    return;
  }
  const toggleBtn = wrapper.locator('> button');
  await toggleBtn.click();
  await visibleDropdown.waitFor({ state: 'attached', timeout: 5000 });
  await visibleDropdown
    .locator('simple-counter-button')
    .first()
    .waitFor({ state: 'visible', timeout: 5000 });
};

/**
 * Helper to get the visible counter buttons locator.
 * On desktop: counters are inline in `.counters-action-group`.
 * On mobile: counters are inside `.mobile-dropdown.isVisible`.
 */
const getVisibleCounters = async (
  client: SimulatedE2EClient,
): Promise<ReturnType<typeof client.page.locator>> => {
  if (await isMobileLayout(client)) {
    return client.page.locator('.mobile-dropdown.isVisible simple-counter-button');
  }
  return client.page.locator('.counters-action-group simple-counter-button');
};

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
   * Scenario: Click counter on Client B doesn't get wrong value
   *
   * This tests the specific bug scenario where:
   * - Client A increments counter to 2
   * - Client B increments counter to 1
   * - Client C syncs and should NOT see 0
   *
   * Actions:
   * 1. Client A creates a click counter, increments to 2, syncs
   * 2. Client B syncs, increments to 3 (2+1), syncs
   * 3. Client C syncs
   * 4. Verify Client C sees 3 (not 0 or any other wrong value)
   */
  test('Click counter maintains correct value across multiple clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    const counterTitle = `MultiClientClick-${uniqueId}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates and increments ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      await createSimpleCounter(clientA, counterTitle, 'click');
      await clientA.page.waitForTimeout(500);

      // Increment to 2
      await incrementClickCounter(clientA);
      await clientA.page.waitForTimeout(200);
      await incrementClickCounter(clientA);
      await clientA.page.waitForTimeout(200);

      const valueA = await getCounterValue(clientA);
      expect(valueA).toBe('2');
      console.log(`Client A counter value: ${valueA}`);

      await clientA.sync.syncAndWait();
      console.log('Client A synced.');

      // ============ PHASE 2: Client B syncs and increments ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('Client B initial sync done.');

      await clientB.page.waitForTimeout(1000);

      // Verify B got the value from A
      let valueB = await getCounterValue(clientB);
      expect(valueB).toBe('2');
      console.log(`Client B after sync: ${valueB}`);

      // B increments (should be 3)
      await incrementClickCounter(clientB);
      await clientB.page.waitForTimeout(200);

      valueB = await getCounterValue(clientB);
      expect(valueB).toBe('3');
      console.log(`Client B after increment: ${valueB}`);

      await clientB.sync.syncAndWait();
      console.log('Client B synced.');

      // ============ PHASE 3: Client C syncs and verifies ============
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      console.log('Client C synced.');

      await clientC.page.waitForTimeout(1000);

      // Verify C sees 3 (not 0 or any other wrong value)
      const valueC = await getCounterValue(clientC);
      console.log(`Client C counter value: ${valueC}`);
      expect(valueC).toBe('3');

      console.log('✓ Multi-client click counter sync verification passed!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
