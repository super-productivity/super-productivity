import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  navigateToMiscSettings,
  toggleSetting,
  isSettingChecked,
  ensureSettingState,
} from '../../utils/config-helpers';

/**
 * SuperSync Global Config Sync Edge Cases E2E Tests
 *
 * Extends the single test in supersync-lww-singleton.spec.ts with additional
 * edge case scenarios for global config synchronization.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-global-config-edge-cases.spec.ts
 */

test.describe('@supersync Global Config Sync Edge Cases', () => {
  /**
   * Scenario: Three-client concurrent config changes converge
   *
   * Tests that when three clients make changes at different times,
   * all converge to the latest state (LWW).
   *
   * Flow:
   * 1. A, B, C set up and converge
   * 2. A drives "Disable all animations" ON and "Disable celebration" ON
   * 3. A syncs → B syncs → C syncs (all get A's change)
   * 4. B toggles "Disable all animations" OFF (earlier timestamp)
   * 5. B syncs
   * 6. Wait for timestamp gap
   * 7. C toggles "Disable celebration" OFF (later timestamp)
   * 8. C syncs → A syncs → B syncs → all converge to C's state
   * 9. GLOBAL_CONFIG `misc` resolves by whole-section LWW: C's later section
   *    replaces B's, so all three end at anim=ON (C never saw B's anim=OFF),
   *    celeb=OFF. No field merge: anim=OFF would mean B's field leaked in.
   */
  test('Three-client concurrent config changes converge to latest', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup three clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);

      // Initial convergence (setup creates globalConfig ops)
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      console.log('[3Client] Setup convergence complete');

      // Client A toggles "Disable all animations" ON
      await navigateToMiscSettings(clientA.page);
      await ensureSettingState(clientA.page, 'Disable all animations', true);
      // Drive celebration ON too, so C's later change below is a real edit
      // regardless of the shipped default.
      await ensureSettingState(clientA.page, 'Disable celebration', true);
      // Leave the config page so formly modelChange cannot re-dispatch during
      // the later syncs and overwrite the winning section.
      await clientA.page.goto('/#/tag/TODAY/tasks');
      await clientA.page.waitForURL(/tag\/TODAY/);
      await clientA.sync.syncAndWait();
      console.log('[3Client] Client A set animations=ON, celebration=ON, synced');

      // All sync to get A's change
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Client B toggles "Disable all animations" OFF (earlier timestamp)
      await navigateToMiscSettings(clientB.page, true);
      await ensureSettingState(clientB.page, 'Disable all animations', false);
      await clientB.page.goto('/#/tag/TODAY/tasks');
      await clientB.page.waitForURL(/tag\/TODAY/);
      await clientB.sync.syncAndWait();
      console.log('[3Client] Client B set animations=OFF, synced');

      // Timestamp gap
      await clientC.page.waitForTimeout(2000);

      // Client C toggles "Disable celebration" OFF (later timestamp). C has
      // not synced since B's change, so C's misc section is anim=ON, celeb=OFF.
      await navigateToMiscSettings(clientC.page, true);
      expect(await isSettingChecked(clientC.page, 'Disable celebration')).toBe(true);
      await ensureSettingState(clientC.page, 'Disable celebration', false);
      // Leave the config page so formly modelChange cannot re-dispatch during sync.
      await clientC.page.goto('/#/tag/TODAY/tasks');
      await clientC.page.waitForURL(/tag\/TODAY/);
      await clientC.sync.syncAndWait();
      console.log('[3Client] Client C set celebration=OFF, synced');

      // Convergence rounds
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      console.log('[3Client] Final convergence complete');

      // Verify all three clients show the same state
      await navigateToMiscSettings(clientA.page, true);
      await navigateToMiscSettings(clientB.page, true);
      await navigateToMiscSettings(clientC.page, true);

      const aAnim = await isSettingChecked(clientA.page, 'Disable all animations');
      const aCeleb = await isSettingChecked(clientA.page, 'Disable celebration');
      const bAnim = await isSettingChecked(clientB.page, 'Disable all animations');
      const bCeleb = await isSettingChecked(clientB.page, 'Disable celebration');
      const cAnim = await isSettingChecked(clientC.page, 'Disable all animations');
      const cCeleb = await isSettingChecked(clientC.page, 'Disable celebration');

      console.log(`[3Client] A: anim=${aAnim}, celeb=${aCeleb}`);
      console.log(`[3Client] B: anim=${bAnim}, celeb=${bCeleb}`);
      console.log(`[3Client] C: anim=${cAnim}, celeb=${cCeleb}`);

      // All clients must have converged to the same state
      expect(aAnim).toBe(bAnim);
      expect(aAnim).toBe(cAnim);
      expect(aCeleb).toBe(bCeleb);
      expect(aCeleb).toBe(cCeleb);

      // The single correct winner: C's whole misc section (later timestamp).
      // anim=ON proves B's earlier anim=OFF lost (no field merge); celeb=OFF
      // proves C's edit won.
      expect(aAnim).toBe(true);
      expect(aCeleb).toBe(false);

      console.log('[3Client] ✓ All three clients converged to same state');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });

  /**
   * Scenario: Rapid successive config toggles result in final state being synced
   *
   * Tests that when a client makes 3 rapid changes to the same setting,
   * only the final state matters and syncs correctly.
   *
   * An odd number of toggles is required: with an even count the final state
   * equals the initial one, so B passes even if nothing syncs at all.
   *
   * Flow:
   * 1. Client A toggles "Disable all animations" 3 times (ends at !initial)
   * 2. Verify B still shows `initial` (nothing synced yet)
   * 3. Client A syncs, client B syncs
   * 4. Verify B has the final state (!initial)
   */
  test('Rapid successive config toggles result in final state synced', async ({
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

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[RapidToggle] Setup convergence complete');

      // Read the initial state (whatever the default is)
      await navigateToMiscSettings(clientA.page);
      const initialState = await isSettingChecked(clientA.page, 'Disable all animations');
      console.log(`[RapidToggle] Initial state: ${initialState}`);

      // B starts at the same state, so a later change on B can only come from sync.
      await navigateToMiscSettings(clientB.page, true);
      expect(await isSettingChecked(clientB.page, 'Disable all animations')).toBe(
        initialState,
      );
      await clientB.page.goto('/#/tag/TODAY/tasks');
      await clientB.page.waitForURL(/tag\/TODAY/);

      // Rapid toggles: 3 times (→ !initial → initial → !initial)
      await toggleSetting(clientA.page, 'Disable all animations');
      await toggleSetting(clientA.page, 'Disable all animations');
      await toggleSetting(clientA.page, 'Disable all animations');
      console.log('[RapidToggle] 3 rapid toggles complete (ends at !initial)');

      const afterToggles = await isSettingChecked(clientA.page, 'Disable all animations');
      expect(afterToggles).toBe(!initialState);
      console.log(`[RapidToggle] After toggles: ${afterToggles}`);

      await clientA.page.goto('/#/tag/TODAY/tasks');
      await clientA.page.waitForURL(/tag\/TODAY/);

      // Sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[RapidToggle] Synced');

      // Verify Client B has the final state
      await navigateToMiscSettings(clientB.page, true);
      const bState = await isSettingChecked(clientB.page, 'Disable all animations');
      expect(bState).toBe(!initialState);
      console.log(`[RapidToggle] Client B state: ${bState}`);

      console.log('[RapidToggle] ✓ Rapid toggle test PASSED');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
