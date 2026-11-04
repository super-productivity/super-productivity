import { type Page, type Response, type WebSocket } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  SUPERSYNC_BASE_URL,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

const blockAutomaticSync = (): void => {
  Object.assign(globalThis, { __SP_E2E_BLOCK_AUTO_SYNC: true });
};

const getPersistedCursor = async (page: Page): Promise<number> =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith('super_sync_last_server_seq_'),
    );
    return key ? Number(localStorage.getItem(key)) : 0;
  });

/**
 * Exercise immediate upload -> WS notification -> durable download with automatic
 * full sync blocked. Reload without sync-server access to rule out startup repair.
 */
test.describe('@supersync Realtime Push', () => {
  test('propagates and persists changes through immediate upload and WebSocket download', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const appUrl = baseURL || 'http://localhost:4242';
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId, {
        serviceWorkers: 'block',
      });
      await clientA.sync.setupSuperSync({ ...syncConfig, enableWebSocket: true });
      await clientA.page.evaluate(blockAutomaticSync);

      const baselineTask = `Realtime-Baseline-${testRunId}`;
      await clientA.workView.addTask(baselineTask);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, baselineTask);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId, {
        serviceWorkers: 'block',
      });
      const connectedSockets = new Set<WebSocket>();
      let notifiedSeq = 0;
      clientB.page.on('websocket', (socket) => {
        if (new URL(socket.url()).pathname !== '/api/sync/ws') return;
        socket.on('framereceived', ({ payload }) => {
          const message = JSON.parse(payload.toString()) as {
            type: string;
            latestSeq?: number;
          };
          if (message.type === 'connected') connectedSockets.add(socket);
          if (message.type === 'new_ops' && message.latestSeq !== undefined) {
            notifiedSeq = Math.max(notifiedSeq, message.latestSeq);
          }
        });
        socket.on('close', () => connectedSockets.delete(socket));
      });
      await clientB.sync.setupSuperSync({ ...syncConfig, enableWebSocket: true });
      await clientB.page.evaluate(blockAutomaticSync);
      await clientB.page.addInitScript(blockAutomaticSync);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, baselineTask);

      // Drain setup ops before measuring; prove the receiver's connection using
      // the server's confirmation frame, rather than assuming manual sync opens it.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expect.poll(() => connectedSockets.size).toBe(1);
      const baselineSeq = await getPersistedCursor(clientB.page);
      expect(baselineSeq).toBeGreaterThan(0);

      const requests = { A: { GET: 0, POST: 0 }, B: { GET: 0, POST: 0 } };
      const uploads: Response[] = [];
      for (const [client, counts] of [
        [clientA, requests.A],
        [clientB, requests.B],
      ] as const) {
        client.page.on('request', (request) => {
          if (new URL(request.url()).pathname !== '/api/sync/ops') return;
          const method = request.method();
          if (method === 'GET' || method === 'POST') counts[method]++;
        });
      }
      clientA.page.on('response', (response) => {
        if (
          new URL(response.url()).pathname === '/api/sync/ops' &&
          response.request().method() === 'POST' &&
          response.ok()
        ) {
          uploads.push(response);
        }
      });

      const pushedTask = `Realtime-Pushed-${testRunId}`;
      const pushStart = Date.now();
      await clientA.workView.addTask(pushedTask);

      // Automatic full sync is blocked too: neither focus nor a trailing timer
      // may rescue a broken immediate-upload or WS-download path.
      await waitForTask(clientB.page, pushedTask, 10000);

      const propagationMs = Date.now() - pushStart;
      expect(propagationMs).toBeLessThan(10000);
      expect(await clientB.sync.hasSyncError()).toBe(false);
      await expect.poll(() => uploads.length).toBe(1);
      const upload = (await uploads[0].json()) as {
        results: { accepted: boolean; serverSeq?: number }[];
      };
      expect(upload.results).toHaveLength(1);
      expect(upload.results[0].accepted).toBe(true);
      const uploadedSeq = upload.results[0].serverSeq!;
      expect(uploadedSeq).toBeGreaterThan(baselineSeq);
      await expect.poll(() => notifiedSeq).toBeGreaterThanOrEqual(uploadedSeq);
      await expect
        .poll(() => getPersistedCursor(clientB!.page))
        .toBeGreaterThanOrEqual(uploadedSeq);
      expect(requests).toEqual({ A: { GET: 0, POST: 1 }, B: { GET: 1, POST: 0 } });
      const appendRequests = structuredClone(requests);

      // Keep app assets reachable, but prevent HTTP or a new WS connection from
      // re-downloading the task during startup. Service workers are blocked above.
      await clientB.context.route(`${SUPERSYNC_BASE_URL}/**`, (route) => route.abort());
      await clientB.context.routeWebSocket('**/api/sync/ws**', (socket) =>
        socket.close(),
      );
      const successfulReloadRequests: string[] = [];
      clientB.page.on('response', (response) => {
        if (response.url().startsWith(`${SUPERSYNC_BASE_URL}/`) && response.ok()) {
          successfulReloadRequests.push(response.url());
        }
      });
      await clientB.page.reload();
      await waitForTask(clientB.page, pushedTask);
      const reloadedSeq = await getPersistedCursor(clientB.page);
      expect(reloadedSeq).toBeGreaterThanOrEqual(uploadedSeq);
      expect(successfulReloadRequests).toEqual([]);
      await test.info().attach('realtime-push-metrics', {
        body: JSON.stringify({
          requests: appendRequests,
          propagationMs,
          uploadedSeq,
          reloadedSeq,
        }),
        contentType: 'application/json',
      });
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
