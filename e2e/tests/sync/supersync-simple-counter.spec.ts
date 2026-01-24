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
  // Navigate to settings using the correct selector
  const settingsBtn = client.page.locator(
    'magic-side-nav .tour-settingsMenuBtn, magic-side-nav nav-item:has([icon="settings"]) button',
  );
  await settingsBtn.waitFor({ state: 'visible', timeout: 15000 });
  await settingsBtn.click();
  await client.page.waitForURL(/config/);
  await client.page.waitForTimeout(500);

  // Navigate to Productivity tab where Simple Counters section is located
  const productivityTab = client.page.locator(
    'mat-tab-header .mat-mdc-tab:has-text("Productivity"), mat-tab-header .mat-tab-label:has-text("Productivity")',
  );
  await productivityTab.waitFor({ state: 'visible', timeout: 10000 });
  await productivityTab.click();
  await client.page.waitForTimeout(500);

  // Click on Simple Counters section (it's inside a collapsible component)
  // The translated title is "Simple Counters & Habit Tracking"
  const simpleCountersSection = client.page.locator(
    '.collapsible-header:has-text("Simple Counters")',
  );

  // Scroll to section and wait for it
  await simpleCountersSection.scrollIntoViewIfNeeded();
  await simpleCountersSection.waitFor({ state: 'visible', timeout: 10000 });
  await simpleCountersSection.click();

  // Wait for collapsible to expand
  await client.page.waitForTimeout(500);

  // Click Add Counter button - text is "Add simple counter/ habit"
  // This is a formly repeat type that adds fields inline (not a dialog)
  // The repeat section type has a footer with the add button
  const addBtn = client.page.locator(
    'repeat-section-type .footer button, button:has-text("Add simple counter")',
  );
  await addBtn.scrollIntoViewIfNeeded();
  await addBtn.waitFor({ state: 'visible', timeout: 5000 });
  await addBtn.click();

  // Wait for inline form fields to appear
  await client.page.waitForTimeout(500);

  // Find the newly added counter row (last one in the list)
  // The repeat section type creates .row elements inside .list-wrapper
  const counterRows = client.page.locator('repeat-section-type .row');
  const lastCounterRow = counterRows.last();

  // Fill title - find the title input in the last counter row
  const titleInput = lastCounterRow.locator('input').first();
  await titleInput.scrollIntoViewIfNeeded();
  await titleInput.waitFor({ state: 'visible', timeout: 5000 });
  await titleInput.fill(title);

  // Select type - find the select in the last counter row
  const typeSelect = lastCounterRow.locator('mat-select').first();
  await typeSelect.scrollIntoViewIfNeeded();
  await typeSelect.click();
  await client.page.waitForTimeout(300);
  const typeOption = client.page.locator(
    `mat-option:has-text("${type === 'click' ? 'Click Counter' : 'Stopwatch'}")`,
  );
  await typeOption.click();

  // Wait for dropdown to close
  await client.page.waitForTimeout(300);

  // Save the form - the simple counter cfg has a Save button
  const saveBtn = client.page.locator(
    'simple-counter-cfg button:has-text("Save"), .submit-button:has-text("Save")',
  );
  await saveBtn.scrollIntoViewIfNeeded();
  await saveBtn.click();

  // Wait for save to complete
  await client.page.waitForTimeout(500);

  // Navigate back to work view using home button or similar
  await client.page.goto('/#/tag/TODAY/tasks');
  await client.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
  await client.page.waitForTimeout(500);
};

/**
 * Helper to get the counter value from the header by title (using mat-tooltip)
 * Desktop counters have [matTooltip]="title" which Angular renders as ng-reflect-message
 */
const getCounterValue = async (
  client: SimulatedE2EClient,
  counterTitle: string,
): Promise<string> => {
  // Wait for simple counters to be rendered
  await client.page.waitForTimeout(500);

  // Find the counter by its tooltip (title)
  // Angular Material's matTooltip directive sets ng-reflect-message attribute
  const counterBtn = client.page.locator(
    `simple-counter-button[ng-reflect-message="${counterTitle}"]`,
  );

  // If not found by ng-reflect, try finding by the wrapper
  if (!(await counterBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    // Alternative: find by checking all counters
    const allCounters = client.page.locator('simple-counter-button');
    const count = await allCounters.count();
    console.log(`Found ${count} simple counter buttons`);

    // Return last counter's value if we can't find by title
    if (count > 0) {
      const lastCounter = allCounters.last();
      const label = lastCounter.locator('.label');
      if (await label.isVisible()) {
        return (await label.textContent()) || '0';
      }
      return '0';
    }
    return '0';
  }

  await expect(counterBtn).toBeVisible({ timeout: 10000 });
  const label = counterBtn.locator('.label');
  // If no label exists (count is 0), return '0'
  if (!(await label.isVisible())) {
    return '0';
  }
  return (await label.textContent()) || '0';
};

/**
 * Helper to increment a click counter by title
 */
const incrementClickCounter = async (
  client: SimulatedE2EClient,
  counterTitle: string,
): Promise<void> => {
  // Find the counter by its tooltip (title)
  const counterBtn = client.page.locator(
    `simple-counter-button[ng-reflect-message="${counterTitle}"]`,
  );

  // If not found by ng-reflect, use last counter
  if (!(await counterBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    const allCounters = client.page.locator('simple-counter-button');
    const lastCounter = allCounters.last();
    await lastCounter.locator('.main-btn').click();
    return;
  }

  await counterBtn.locator('.main-btn').click();
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
        await incrementClickCounter(clientA, counterTitle);
        await clientA.page.waitForTimeout(200);
      }

      // Verify Client A shows 3
      const valueA = await getCounterValue(clientA, counterTitle);
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
      const valueB = await getCounterValue(clientB, counterTitle);
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
      await incrementClickCounter(clientA, counterTitle);
      await clientA.page.waitForTimeout(200);
      await incrementClickCounter(clientA, counterTitle);
      await clientA.page.waitForTimeout(200);

      const valueA = await getCounterValue(clientA, counterTitle);
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
      let valueB = await getCounterValue(clientB, counterTitle);
      expect(valueB).toBe('2');
      console.log(`Client B after sync: ${valueB}`);

      // B increments (should be 3)
      await incrementClickCounter(clientB, counterTitle);
      await clientB.page.waitForTimeout(200);

      valueB = await getCounterValue(clientB, counterTitle);
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
      const valueC = await getCounterValue(clientC, counterTitle);
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
