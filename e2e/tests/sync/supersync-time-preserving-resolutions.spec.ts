import { test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
} from '../../utils/supersync-helpers';
import {
  blockBackgroundSync,
  runReminderClearScenario,
  runIncomingNotesScenario,
  type JoinResolutionClient,
} from '../../utils/time-preserving-resolution-helpers';
import type { Browser } from '@playwright/test';

const createJoin = async (
  browser: Browser,
  baseURL: string,
  testRunId: string,
): Promise<JoinResolutionClient> => {
  const config = getSuperSyncConfig(await createTestUser(testRunId));
  return async (name) => {
    const client = await createSimulatedClient(browser, baseURL, name, testRunId);
    await client.page.evaluate(blockBackgroundSync);
    await client.page.addInitScript(blockBackgroundSync);
    await client.sync.setupSuperSync(config);
    return {
      page: client.page,
      workView: client.workView,
      sync: () => client.sync.syncAndWait(),
      close: () => closeClient(client),
    };
  };
};

test.describe('@supersync time-preserving conflict resolution', () => {
  for (const firstSync of ['A', 'B'] as const) {
    test(`${firstSync}-first a winning plan clears scheduled time and reminder everywhere`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);
      const join = await createJoin(browser, baseURL!, testRunId);
      await runReminderClearScenario(join, `TimePreserving-${testRunId}`, firstSync);
    });
  }
  test('conflict resolution preserves concurrent downloaded notes', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    await runIncomingNotesScenario(
      await createJoin(browser, baseURL!, testRunId),
      `IncomingNotes-${testRunId}`,
    );
  });
});
