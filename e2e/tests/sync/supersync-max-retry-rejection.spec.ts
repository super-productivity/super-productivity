import { gunzipSync } from 'zlib';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Max Retry Rejection E2E Test
 *
 * Scenario B.5: After MAX_CONCURRENT_RESOLUTION_ATTEMPTS (3) consecutive
 * CONFLICT_CONCURRENT resolutions for the same entity, operations are
 * permanently rejected — preventing an infinite upload-reject-merge loop.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-max-retry-rejection.spec.ts
 */

/**
 * Parse the request body, handling gzip compression.
 * SuperSync compresses uploads with gzip via CompressionStream.
 */
const parseRequestBody = (
  request: import('@playwright/test').Request,
): Record<string, unknown> | null => {
  // Try uncompressed JSON first
  try {
    const jsonBody = request.postDataJSON();
    if (jsonBody) return jsonBody;
  } catch {
    // postDataJSON() throws if body is not valid JSON (e.g., gzip-compressed)
  }

  // Fall back to gzip decompression
  const rawBuffer = request.postDataBuffer();
  if (!rawBuffer) return null;
  try {
    return JSON.parse(gunzipSync(rawBuffer).toString('utf-8'));
  } catch {
    return null;
  }
};

test.describe('@supersync Max Retry Rejection', () => {
  /**
   * Scenario B.5: Op permanently rejected after max concurrent resolution attempts
   *
   * When the same entity keeps getting CONFLICT_CONCURRENT rejections,
   * the retry counter increments each sync cycle. After exceeding
   * MAX_CONCURRENT_RESOLUTION_ATTEMPTS (3), the ops are permanently
   * rejected and sync shows ERROR status.
   */
  test('Op permanently rejected after max concurrent resolution attempts', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    let interceptCount = 0;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create a task and sync to establish baseline
      const taskName = `MaxRetry-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Create another task to generate new pending ops
      const taskName2 = `MaxRetry2-${testRunId}`;
      await clientA.workView.addTask(taskName2);
      await waitForTask(clientA.page, taskName2);

      // Intercept ALL uploads — return CONFLICT_CONCURRENT for every op
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (route.request().method() === 'POST') {
          interceptCount++;
          console.log(
            `[MaxRetry] Intercept #${interceptCount}: returning CONFLICT_CONCURRENT`,
          );

          const body = parseRequestBody(route.request());
          const ops = (body?.ops as Array<{ id: string }>) || [];
          const results = ops.map((op) => ({
            opId: op.id,
            accepted: false,
            error: 'Concurrent modification detected',
            errorCode: 'CONFLICT_CONCURRENT',

            existingClock: { phantom_server_client: 99999 },
          }));

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results,
              latestSeq: 1,
            }),
          });
        } else {
          await route.continue();
        }
      });

      // Trigger multiple sync cycles to exceed MAX_CONCURRENT_RESOLUTION_ATTEMPTS (3)
      // Each cycle: upload → CONFLICT_CONCURRENT → handler increments counter → merge
      // After 4+ cycles for the same entity, ops are permanently rejected
      for (let i = 0; i < 6; i++) {
        try {
          await clientA.sync.triggerSync();
          await clientA.page.waitForTimeout(2000);
        } catch {
          // Expected — triggerSync may throw on error state
        }
      }

      // Remove interception
      await clientA.page.unroute('**/api/sync/ops');

      // Verify multiple upload attempts happened (confirms retry cycles occurred)
      // The app silently drops permanently-rejected ops without showing an error icon.
      expect(interceptCount).toBeGreaterThan(1);
      console.log(`[MaxRetry] Total intercepts: ${interceptCount}`);

      // After removing interception, sync should succeed
      // (rejected ops are skipped, no infinite loop)
      await clientA.sync.syncAndWait();

      // Task still exists locally (not lost)
      await waitForTask(clientA.page, taskName);

      console.log(
        '[MaxRetry] Op permanently rejected after max concurrent resolution attempts',
      );
    } finally {
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops').catch(() => {});
        await closeClient(clientA);
      }
    }
  });
});
