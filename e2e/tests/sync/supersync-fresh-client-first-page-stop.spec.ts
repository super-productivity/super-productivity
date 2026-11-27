import {
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsResponseSchema,
  type SuperSyncOperation,
} from '@sp/shared-schema/supersync-http-contract';
import { decrypt } from '@sp/sync-core';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  SUPERSYNC_BASE_URL,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  routeSuperSyncOps,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';

// Survey report (2026-11) and #9439 follow-up: "syncing stopping after
// downloading first 500 operations" on a fresh install. 500 is the app's
// DOWNLOAD_PAGE_SIZE; these tests leave it untouched.
const PAGE_SIZE = 500;
const BACKLOG_OPS = 600;

type DownloadHistory = ReturnType<typeof SuperSyncDownloadOpsResponseSchema.parse>;

interface DownloadedPage {
  sinceSeq: number;
  opCount: number;
  hasMore: boolean;
}

const jsonHeaders = (token?: string): Headers => {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
};

const getServerHistory = async (token: string): Promise<DownloadHistory> => {
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=0`, {
    headers: jsonHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to read SuperSync history: ${response.status}`);
  }
  return SuperSyncDownloadOpsResponseSchema.parse(await response.json());
};

const mergeHistoryClock = (history: DownloadHistory): Record<string, number> => {
  const merged: Record<string, number> = {};
  for (const { op } of history.ops) {
    for (const [clientId, counter] of Object.entries(op.vectorClock)) {
      merged[clientId] = Math.max(merged[clientId] ?? 0, counter);
    }
  }
  return merged;
};

/**
 * Stores a genuine app-created task op as plaintext through the TEST_MODE seed
 * route, the shape left behind by clients older than the upload guard (#8670).
 * The production upload gate no longer accepts such a row.
 */
const seedLegacyPlaintextOp = async (
  userId: number,
  password: string,
  source: SuperSyncOperation,
  history: DownloadHistory,
): Promise<void> => {
  if (typeof source.payload !== 'string') throw new Error('Source op is not encrypted');
  const clientId = `first_page_plain_${userId}`;
  const op = SuperSyncOperationSchema.parse({
    ...source,
    id: crypto.randomUUID(),
    clientId,
    payload: JSON.parse(await decrypt(source.payload, password)),
    vectorClock: { ...mergeHistoryClock(history), [clientId]: 1 },
    timestamp: Date.now(),
    isPayloadEncrypted: false,
  });
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/legacy-plaintext-ops`,
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ op }) },
  );
  if (!response.ok) {
    throw new Error(`Failed to seed plaintext operation: ${response.status}`);
  }
};

/** Uploads copies of a genuine encrypted op through the production endpoint. */
const seedEncryptedBacklog = async (
  token: string,
  clientId: string,
  source: SuperSyncOperation,
  historyClock: Record<string, number>,
): Promise<void> => {
  for (let offset = 0; offset < BACKLOG_OPS; offset += SUPER_SYNC_MAX_OPS_PER_UPLOAD) {
    const ops = Array.from(
      { length: Math.min(SUPER_SYNC_MAX_OPS_PER_UPLOAD, BACKLOG_OPS - offset) },
      (_, index): SuperSyncOperation => ({
        ...source,
        id: crypto.randomUUID(),
        clientId,
        vectorClock: { ...historyClock, [clientId]: offset + index + 1 },
        timestamp: Date.now(),
      }),
    );
    const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ clientId, ops }),
    });
    if (!response.ok) {
      throw new Error(`Failed to seed SuperSync backlog: ${response.status}`);
    }
    const result = SuperSyncUploadOpsResponseSchema.parse(await response.json());
    expect(result.results.every((entry) => entry.accepted)).toBe(true);
  }
};

const recordDownloadedPages = async (
  client: SimulatedE2EClient,
): Promise<DownloadedPage[]> => {
  const pages: DownloadedPage[] = [];
  await routeSuperSyncOps(client.page, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const sinceSeq = Number(
      new URL(route.request().url()).searchParams.get('sinceSeq') ?? 0,
    );
    const response = await route.fetch();
    const body = SuperSyncDownloadOpsResponseSchema.parse(await response.json());
    pages.push({ sinceSeq, opCount: body.ops.length, hasMore: body.hasMore });
    await route.fulfill({ response });
  });
  return pages;
};

const getCursor = (client: SimulatedE2EClient): Promise<number> =>
  client.page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith('super_sync_last_server_seq_'),
    );
    return Number(key ? localStorage.getItem(key) : 0);
  });

test.describe('@supersync @encryption fresh client on an account with more than 500 operations', () => {
  for (const hasLegacyPlaintextOp of [false, true]) {
    // The plaintext variant pins today's stop (#9439), not the desired behavior:
    // a fix that lets such a client recover should flip its assertions.
    const title = hasLegacyPlaintextOp
      ? 'stops after the first 500 operations when that page holds a legacy plaintext operation'
      : 'pages past the first 500 operations and shows all data';

    test(title, async ({ browser, baseURL, testRunId }) => {
      test.setTimeout(300000);
      let establishedClient: SimulatedE2EClient | null = null;
      let freshClient: SimulatedE2EClient | null = null;

      try {
        const user = await createTestUser(testRunId);
        const password = `first-page-${testRunId}`;
        const syncConfig = {
          ...getSuperSyncConfig(user),
          isEncryptionEnabled: true,
          password,
        };
        const firstTask = `First-task-${testRunId}`;
        const renamedFirstTask = `Renamed-task-${testRunId}`;
        const lastTask = `Beyond-first-page-${testRunId}`;

        establishedClient = await createSimulatedClient(
          browser,
          baseURL!,
          'established',
          testRunId,
        );
        await establishedClient.workView.waitForTaskList();
        await establishedClient.sync.setupSuperSync(syncConfig);
        await establishedClient.workView.addTask(firstTask);
        await establishedClient.sync.syncAndWait();
        const task = establishedClient.page.locator(`task:has-text("${firstTask}")`);
        await task.locator('task-title').click();
        await task.locator('textarea').fill(renamedFirstTask);
        await establishedClient.page.keyboard.press('Tab');
        await expect(
          establishedClient.page.locator(`task:has-text("${renamedFirstTask}")`),
        ).toBeVisible();
        await establishedClient.sync.syncAndWait();

        let history = await getServerHistory(user.token);
        const taskUpdate = history.ops.find(
          ({ op }) =>
            op.entityType === 'TASK' &&
            op.opType === 'UPD' &&
            op.isPayloadEncrypted === true &&
            typeof op.payload === 'string',
        )?.op;
        if (!taskUpdate) throw new Error('No genuine encrypted task update to seed');
        const source = SuperSyncOperationSchema.parse(taskUpdate);

        if (hasLegacyPlaintextOp) {
          await seedLegacyPlaintextOp(user.userId, password, source, history);
          history = await getServerHistory(user.token);
        }
        await seedEncryptedBacklog(
          user.token,
          `first_page_${testRunId}`,
          source,
          mergeHistoryClock(history),
        );
        // Only the healthy account adds a task beyond the first page: here the
        // plaintext row sits after the established client's cursor, so that
        // client's next download would be rejected as well.
        if (!hasLegacyPlaintextOp) {
          await establishedClient.sync.syncAndWait({ timeout: 90000 });
          await establishedClient.workView.addTask(lastTask);
          await establishedClient.sync.syncAndWait({ timeout: 90000 });
        }
        const serverSeqBefore = (await getServerHistory(user.token)).latestSeq;
        expect(serverSeqBefore).toBeGreaterThan(BACKLOG_OPS);

        freshClient = await createSimulatedClient(browser, baseURL!, 'fresh', testRunId);
        await freshClient.workView.waitForTaskList();
        const pages = await recordDownloadedPages(freshClient);

        if (!hasLegacyPlaintextOp) {
          await freshClient.sync.setupSuperSync(syncConfig);
          await waitForTask(freshClient.page, lastTask);
          await waitForTask(freshClient.page, renamedFirstTask);
          expect(pages[0]).toEqual({ sinceSeq: 0, opCount: PAGE_SIZE, hasMore: true });
          expect(pages.some((page) => page.sinceSeq > 0 && !page.hasMore)).toBe(true);
          await expect(freshClient.sync.syncErrorIcon).not.toBeVisible();
          expect(await getCursor(freshClient)).toBe(serverSeqBefore);
          return;
        }

        await freshClient.sync.setupSuperSync({
          ...syncConfig,
          waitForInitialSync: false,
        });
        await expect(freshClient.sync.syncErrorIcon).toBeVisible({ timeout: 60000 });

        // The reported symptom: one full page arrives, more is available, and
        // the client never asks for the second page.
        expect(pages[0]).toEqual({ sinceSeq: 0, opCount: PAGE_SIZE, hasMore: true });
        expect(pages.every((page) => page.sinceSeq === 0)).toBe(true);
        await expect(
          freshClient.page.locator(`task:has-text("${renamedFirstTask}")`),
        ).toHaveCount(0);
        expect(await getCursor(freshClient)).toBe(0);

        // A retry repeats the same first page instead of progressing.
        const pagesBeforeRetry = pages.length;
        await freshClient.sync.syncBtn.click();
        await expect
          .poll(() => pages.length, { timeout: 30000 })
          .toBeGreaterThan(pagesBeforeRetry);
        expect(pages.every((page) => page.sinceSeq === 0)).toBe(true);
        expect(await getCursor(freshClient)).toBe(0);
        // Asserted after the explicit retry: the snack from the setup sync can
        // already be dismissed by the time setup returns.
        await expect(
          freshClient.page.locator('snack-custom', {
            hasText: 'security integrity check',
          }),
        ).toBeVisible({ timeout: 30000 });

        // Nothing is lost: the server copy is untouched.
        expect((await getServerHistory(user.token)).latestSeq).toBe(serverSeqBefore);
      } finally {
        if (establishedClient) await closeClient(establishedClient);
        if (freshClient) await closeClient(freshClient);
      }
    });
  }
});
