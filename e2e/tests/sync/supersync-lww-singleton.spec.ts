import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync LWW Singleton Entity Conflict Resolution E2E Tests
 *
 * Tests that singleton entities (GLOBAL_CONFIG) correctly resolve conflicts
 * via LWW when the lwwUpdateMetaReducer handles them.
 *
 * Before the fix: singleton LWW Update actions were silently dropped because
 * lwwUpdateMetaReducer only handled adapter entities.
 *
 * After the fix: singleton entities replace the entire feature state with the
 * winning LWW data.
 */

/**
 * Navigate to Misc Settings section in the config page (General tab)
 * and expand it if collapsed.
 *
 * When `forceReload` is true, navigates away first then back to ensure the
 * OnPush config component is fully re-created with fresh store data.
 */
const navigateToMiscSettings = async (page: Page, forceReload = false): Promise<void> => {
  if (forceReload) {
    // Navigate away first to destroy the config component, then back
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForURL(/tag\/TODAY/);
  }
  await page.goto('/#/config');
  await page.waitForURL(/config/);

  // "Misc Settings" is a collapsible section in the General tab (default tab).
  const miscCollapsible = page.locator(
    'collapsible:has(.collapsible-title:has-text("Misc"))',
  );
  await miscCollapsible.waitFor({ state: 'visible', timeout: 10000 });
  await miscCollapsible.scrollIntoViewIfNeeded();

  // Expand if collapsed (host element gets .isExpanded class when expanded)
  const isExpanded = await miscCollapsible.evaluate((el: Element) =>
    el.classList.contains('isExpanded'),
  );
  if (!isExpanded) {
    await miscCollapsible.locator('.collapsible-header').click();
    // Wait for the collapsible panel to appear (conditionally rendered via @if)
    await miscCollapsible
      .locator('.collapsible-panel')
      .waitFor({ state: 'visible', timeout: 5000 });
  }
};

/**
 * Toggle a slide-toggle setting by its label text.
 */
const toggleSetting = async (page: Page, labelText: string): Promise<void> => {
  const toggle = page
    .locator('mat-slide-toggle, mat-checkbox')
    .filter({ hasText: labelText })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  // Capture current checked state before clicking
  const wasChecked = await toggle.evaluate((el: Element) =>
    el.className.includes('checked'),
  );
  await toggle.click();
  // Wait for toggle state to change
  if (wasChecked) {
    await expect(toggle).not.toHaveClass(/checked/, { timeout: 5000 });
  } else {
    await expect(toggle).toHaveClass(/checked/, { timeout: 5000 });
  }
};

/**
 * Check whether a slide-toggle is currently checked (ON).
 */
const isSettingChecked = async (page: Page, labelText: string): Promise<boolean> => {
  const toggle = page
    .locator('mat-slide-toggle, mat-checkbox')
    .filter({ hasText: labelText })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  // mat-slide-toggle adds 'mat-mdc-slide-toggle-checked' when checked
  // mat-checkbox adds 'mat-mdc-checkbox-checked' when checked
  const classes = (await toggle.getAttribute('class')) ?? '';
  return classes.includes('checked');
};

test.describe('@supersync SuperSync LWW Singleton Conflict Resolution', () => {
  /**
   * Scenario: LWW Singleton Global Config Conflict Resolution
   *
   * Tests that when two clients make concurrent changes to globalConfig,
   * LWW correctly resolves the conflict and all clients converge to the
   * winning state via the lwwUpdateMetaReducer singleton fix.
   *
   * Key insight: For LOCAL to win the LWW conflict (and trigger creation of
   * a `[GLOBAL_CONFIG] LWW Update` operation), the client with the later
   * timestamp must sync AFTER the earlier client's op is already on the server.
   *
   * Flow:
   * 1. Client A + Client B set up with SuperSync
   * 2. Client A toggles both settings ON, syncs
   * 3. Client B syncs (downloads config), verifies both toggles are ON
   * 4. Client B toggles "Disable all animations" OFF (earlier timestamp)
   * 5. Client B syncs first → uploads B's change to server
   * 6. Wait for timestamp gap
   * 7. Client A toggles "Disable celebration" OFF (later timestamp)
   * 8. Client A syncs → upload conflicts with B's server op
   *    → LOCAL A wins (later timestamp) → creates [GLOBAL_CONFIG] LWW Update
   * 9. Client A syncs again → uploads LWW Update to server
   * 10. Client B syncs → downloads LWW Update → lwwUpdateMetaReducer applies it
   * 11. Verify both clients converge to A's winning state
   */
  test('LWW: Global config singleton conflict resolves correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Converge after setup: both setupSuperSync calls create GLOBAL_CONFIG:sync
      // operations that may conflict. Resolve them now so the globalConfig is stable
      // before we test the misc settings conflict.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[LWW-Singleton] Setup convergence complete');

      // 2. Client A navigates to Misc settings and toggles both settings ON
      await navigateToMiscSettings(clientA.page);

      // Verify default state before toggling (both should be OFF)
      const aAnimDefault = await isSettingChecked(clientA.page, 'Disable all animations');
      const aCelebDefault = await isSettingChecked(clientA.page, 'Disable celebration');
      expect(aAnimDefault).toBe(false);
      expect(aCelebDefault).toBe(false);

      await toggleSetting(clientA.page, 'Disable all animations');
      await toggleSetting(clientA.page, 'Disable celebration');
      console.log('[LWW-Singleton] Client A toggled both settings ON');

      await clientA.sync.syncAndWait();
      console.log('[LWW-Singleton] Client A synced (initial)');

      // 3. Client B syncs to get the config, then verify UI
      await clientB.sync.syncAndWait();
      console.log('[LWW-Singleton] Client B synced (download)');

      await navigateToMiscSettings(clientB.page, true);
      const bAnimAfterSync = await isSettingChecked(
        clientB.page,
        'Disable all animations',
      );
      const bCelebAfterSync = await isSettingChecked(clientB.page, 'Disable celebration');
      expect(bAnimAfterSync).toBe(true);
      expect(bCelebAfterSync).toBe(true);
      console.log('[LWW-Singleton] Client B confirmed both settings ON');

      // 4. Client B toggles "Disable all animations" OFF (earlier timestamp)
      await toggleSetting(clientB.page, 'Disable all animations');
      console.log(
        '[LWW-Singleton] Client B toggled animations OFF (B: anim=OFF, celeb=ON)',
      );

      // 5. Client B syncs FIRST → uploads B's change to server
      await clientB.sync.syncAndWait();
      console.log('[LWW-Singleton] Client B synced (uploaded change)');

      // 6. Wait for timestamp gap to ensure A's change has a later timestamp
      await clientA.page.waitForTimeout(2000);

      // 7. Client A toggles "Disable celebration" OFF (later timestamp)
      await toggleSetting(clientA.page, 'Disable celebration');
      console.log(
        '[LWW-Singleton] Client A toggled celebration OFF (A: anim=ON, celeb=OFF)',
      );

      // 8. Client A syncs → upload conflicts with B's op on server
      //    LOCAL A wins (later timestamp) → creates [GLOBAL_CONFIG] LWW Update
      await clientA.sync.syncAndWait();
      console.log(
        '[LWW-Singleton] Client A synced (conflict → LOCAL wins → LWW Update created)',
      );

      // 9. Client A syncs again → uploads LWW Update to server
      await clientA.sync.syncAndWait();
      console.log('[LWW-Singleton] Client A synced (LWW Update uploaded)');

      // 10. Client B syncs → downloads LWW Update → meta-reducer applies it
      await clientB.sync.syncAndWait();
      console.log('[LWW-Singleton] Client B synced (LWW Update applied)');

      // Extra convergence round
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[LWW-Singleton] Final convergence sync complete');

      // 11. Verify both clients show the same winning state.
      // A's state should win (later timestamp): anim=ON, celeb=OFF
      // Force reload to re-create the OnPush config component with fresh store data.
      await navigateToMiscSettings(clientA.page, true);
      const aAnimFinal = await isSettingChecked(clientA.page, 'Disable all animations');
      const aCelebFinal = await isSettingChecked(clientA.page, 'Disable celebration');

      await navigateToMiscSettings(clientB.page, true);
      const bAnimFinal = await isSettingChecked(clientB.page, 'Disable all animations');
      const bCelebFinal = await isSettingChecked(clientB.page, 'Disable celebration');

      console.log(
        `[LWW-Singleton] A: anim=${aAnimFinal}, celeb=${aCelebFinal}` +
          ` | B: anim=${bAnimFinal}, celeb=${bCelebFinal}`,
      );

      // Both clients should have converged to the same state
      expect(aAnimFinal).toBe(bAnimFinal);
      expect(aCelebFinal).toBe(bCelebFinal);

      // The winning state should be A's state: animations ON, celebration OFF
      expect(aAnimFinal).toBe(true);
      expect(aCelebFinal).toBe(false);
      expect(bAnimFinal).toBe(true);
      expect(bCelebFinal).toBe(false);

      console.log(
        '[LWW-Singleton] Global config singleton conflict resolved correctly via LWW',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
