import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  enablePluginWithVerification,
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

/**
 * SuperSync Plugin User Data E2E Tests (#9526)
 *
 * Plugin data persisted via PluginAPI.persistDataSynced() syncs as
 * PLUGIN_USER_DATA ops. Since v18.10.0 LWW conflict resolution emits synthetic
 * `[PLUGIN_USER_DATA] LWW Update` ops for conflict winners — but until #9526
 * the receiving client's lwwUpdateMetaReducer only supported singleton and
 * adapter storage patterns, so array-entity winners were silently dropped
 * ("Unsupported storage pattern") and clients diverged permanently.
 *
 * These tests drive the REAL pipeline end to end: plugin iframe → postMessage
 * bridge → NgRx store → op-log → SuperSync server → other client.
 */

const PLUGIN_IFRAME = 'plugin-index iframe';
const PLUGIN_NAME = 'API Test Plugin';
const PLUGIN_URL = '/#/plugins/api-test-plugin/index';

const enableApiTestPlugin = async (client: SimulatedE2EClient): Promise<void> => {
  const assetsAvailable = await waitForPluginAssets(client.page);
  if (!assetsAvailable) {
    throw new Error(`[${client.clientName}] Plugin assets not available`);
  }
  const initSuccess = await waitForPluginManagementInit(client.page);
  if (!initSuccess) {
    throw new Error(`[${client.clientName}] Plugin management failed to initialize`);
  }
  // Idempotent: only toggles when the plugin is not already enabled (it may
  // already be enabled via a synced PLUGIN_METADATA op from the other client).
  const enabled = await enablePluginWithVerification(client.page, PLUGIN_NAME, 15000);
  if (!enabled) {
    throw new Error(`[${client.clientName}] Failed to enable ${PLUGIN_NAME}`);
  }
};

/** Opens the plugin's iframe view and waits for the bridge to be usable. */
const openPluginFrame = async (
  client: SimulatedE2EClient,
): Promise<ReturnType<SimulatedE2EClient['page']['frameLocator']>> => {
  await client.page.goto(PLUGIN_URL);
  const iframe = client.page.locator(PLUGIN_IFRAME);
  await iframe.waitFor({ state: 'visible', timeout: 15000 });
  const frame = client.page.frameLocator(PLUGIN_IFRAME);
  await frame.locator('body').waitFor({ state: 'visible', timeout: 15000 });
  await frame
    .locator('body')
    .evaluate((_el) =>
      (window as unknown as Record<string, unknown>).PluginAPI ? true : false,
    );
  return frame;
};

const persistPluginData = async (
  client: SimulatedE2EClient,
  data: string,
): Promise<void> => {
  const frame = await openPluginFrame(client);
  await frame.locator('body').evaluate(async (_el, dataToPersist) => {
    const api = (
      window as unknown as {
        PluginAPI: { persistDataSynced: (d: string) => Promise<void> };
      }
    ).PluginAPI;
    await api.persistDataSynced(dataToPersist);
  }, data);
};

const loadPluginData = async (client: SimulatedE2EClient): Promise<string | null> => {
  const frame = await openPluginFrame(client);
  return frame.locator('body').evaluate(async () => {
    const api = (
      window as unknown as {
        PluginAPI: { loadPersistedData: () => Promise<string | null> };
      }
    ).PluginAPI;
    return api.loadPersistedData();
  });
};

test.describe('@supersync SuperSync Plugin User Data', () => {
  /**
   * Scenario: plugin data syncs between clients (non-conflict baseline) and a
   * concurrent-edit conflict propagates the LWW winner to the losing client.
   *
   * Actions:
   * 1.  Client A enables the plugin, persists SEED, syncs
   * 2.  Client B syncs (receives plugin metadata + data), verifies SEED
   * 3.  Client B persists B-DATA (earlier timestamp)
   * 4.  Client A persists A-DATA (later timestamp)
   * 5.  Client B syncs first (uploads B-DATA)
   * 6.  Client A syncs (conflict → LWW → A wins → uploads
   *     [PLUGIN_USER_DATA] LWW Update carrying A-DATA)
   * 7.  Client B syncs (receives the LWW Update op)
   * 8.  KEY: B now reads A-DATA — without the #9526 array branch the op is
   *     dropped ("Unsupported storage pattern") and B keeps B-DATA forever
   */
  test('plugin data conflict: LWW winner propagates to the losing client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    const seedData = JSON.stringify({ v: `seed-${testRunId}` });
    const dataA = JSON.stringify({ v: `A-${testRunId}` });
    const dataB = JSON.stringify({ v: `B-${testRunId}` });

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A enables the plugin and persists the seed value
      await enableApiTestPlugin(clientA);
      await persistPluginData(clientA, seedData);
      await clientA.sync.syncAndWait();
      console.log('[PluginData] Client A persisted seed and synced');

      // 2. Client B syncs and must see A's data (plain upsert op — baseline)
      await clientB.sync.syncAndWait();
      await enableApiTestPlugin(clientB);
      expect(await loadPluginData(clientB)).toBe(seedData);
      console.log('[PluginData] ✓ Baseline: plugin data synced A → B');

      // 3. Client B writes first (earlier timestamp)
      await persistPluginData(clientB, dataB);

      // 4. Timestamp gap, then Client A writes (later timestamp → LWW winner)
      await clientA.page.waitForTimeout(1200);
      await persistPluginData(clientA, dataA);

      // 5. Client B uploads its change first
      await clientB.sync.syncAndWait();

      // 6. Client A syncs: server reports the conflict, LWW resolution picks
      //    A's later write, and A uploads the synthetic LWW Update op
      await clientA.sync.syncAndWait();

      // 7. Client B receives the LWW Update op
      await clientB.sync.syncAndWait();

      // 8. KEY assertion: B applied the array-entity LWW winner
      expect(await loadPluginData(clientB)).toBe(dataA);
      console.log('[PluginData] ✓ LWW winner applied on losing client B');

      // A keeps its winning value; extra round proves convergence is stable
      await clientA.sync.syncAndWait();
      expect(await loadPluginData(clientA)).toBe(dataA);
      console.log('[PluginData] ✓ Clients converged on the LWW winner');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
