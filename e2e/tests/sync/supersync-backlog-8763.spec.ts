import {
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsResponseSchema,
  type SuperSyncOperation,
} from '@sp/shared-schema';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  SUPERSYNC_BASE_URL,
  closeClient,
  createSimulatedClient,
  createTestUser,
  deleteTestUser,
  getSuperSyncConfig,
  routeSuperSyncOps,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';

const PAGE_CAP = 1000; // MAX_DOWNLOAD_ITERATIONS in the app
type DownloadHistory = ReturnType<typeof SuperSyncDownloadOpsResponseSchema.parse>;

const getCursor = (client: SimulatedE2EClient): Promise<number> =>
  client.page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith('super_sync_last_server_seq_'),
    );
    return Number(key ? localStorage.getItem(key) : 0);
  });

const getServerHistory = async (
  token: string,
  sinceSeq = 0,
): Promise<DownloadHistory> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=${sinceSeq}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Failed to read SuperSync history: ${response.status}`);
  }
  return SuperSyncDownloadOpsResponseSchema.parse(await response.json());
};

const seedBacklog = async (
  token: string,
  clientId: string,
  source: SuperSyncOperation,
  historyClock: Record<string, number>,
  count = PAGE_CAP + 1,
): Promise<void> => {
  for (let offset = 0; offset < count; offset += SUPER_SYNC_MAX_OPS_PER_UPLOAD) {
    const ops = Array.from(
      { length: Math.min(SUPER_SYNC_MAX_OPS_PER_UPLOAD, count - offset) },
      (_, index): SuperSyncOperation => ({
        ...source,
        id: crypto.randomUUID(),
        clientId,
        vectorClock: { ...historyClock, [clientId]: offset + index + 1 },
        timestamp: Date.now(),
      }),
    );
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    headers.set('Content-Type', 'application/json');
    const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId, ops }),
    });
    if (!response.ok) {
      throw new Error(`Failed to seed SuperSync backlog: ${response.status}`);
    }
    const result = SuperSyncUploadOpsResponseSchema.parse(await response.json());
    expect(result.results).toHaveLength(ops.length);
    expect(result.results.every((entry) => entry.accepted)).toBe(true);
  }
};

const wipeUserSyncData = async (token: string, userId: number): Promise<void> => {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/data`, {
    method: 'DELETE',
    headers,
    body: '{}',
  });
  if (!response.ok)
    throw new Error(`Failed to reset test user's history: ${response.status}`);
  // Normal deletion preserves the sequence counter. The existing backup-restore
  // test route also removes that counter, reproducing an older database restore.
  const rewind = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops-after/0`,
    {
      method: 'DELETE',
    },
  );
  if (!rewind.ok) throw new Error(`Failed to rewind test history: ${rewind.status}`);
};

const uploadSavedOp = async (token: string, op: SuperSyncOperation): Promise<void> => {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clientId: op.clientId, ops: [op] }),
  });
  if (!response.ok)
    throw new Error(`Failed to restore final task op: ${response.status}`);
  const result = SuperSyncUploadOpsResponseSchema.parse(await response.json());
  expect(result.results[0]?.accepted).toBe(true);
};

test.describe('@supersync #8763 backlog beyond one download pass', () => {
  for (const resetServer of [false, true]) {
    test(`${resetServer ? 'server rewind' : 'ordinary backlog'} automatically resumes and applies the final task`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(resetServer ? 420000 : 300000);
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;
      let userId: number | undefined;

      try {
        const user = await createTestUser(testRunId);
        userId = user.userId;
        const syncConfig = {
          ...getSuperSyncConfig(user),
          isEncryptionEnabled: true,
          password: `backlog-8763-${testRunId}`,
        };
        const seedTask = `Backlog-seed-${testRunId}`;
        const updatedSeedTask = `Backlog-updated-${testRunId}`;
        const finalTask = `Beyond-page-cap-${testRunId}`;

        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        await clientA.workView.waitForTaskList();
        await clientA.sync.setupSuperSync(syncConfig);
        await clientA.workView.addTask(seedTask);
        await clientA.sync.syncAndWait();
        const task = clientA.page.locator(`task:has-text("${seedTask}")`);
        await task.locator('task-title').click();
        await task.locator('textarea').fill(updatedSeedTask);
        await clientA.page.keyboard.press('Tab');
        await expect(
          clientA.page.locator(`task:has-text("${updatedSeedTask}")`),
        ).toBeVisible();
        await clientA.sync.syncAndWait();

        const history = await getServerHistory(user.token);
        const source = history.ops.find(
          ({ op }) =>
            op.entityType === 'TASK' &&
            op.opType === 'UPD' &&
            op.isPayloadEncrypted === true &&
            typeof op.payload === 'string',
        )?.op;
        if (!source) throw new Error('No genuine encrypted task update to seed');
        const historyClock: Record<string, number> = {};
        for (const { op } of history.ops) {
          for (const [clientId, counter] of Object.entries(op.vectorClock)) {
            historyClock[clientId] = Math.max(historyClock[clientId] ?? 0, counter);
          }
        }

        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        await clientB.workView.waitForTaskList();
        await clientB.sync.setupSuperSync(syncConfig);
        await waitForTask(clientB.page, updatedSeedTask);
        const initialCursor = await getCursor(clientB);
        expect(initialCursor).toBe(history.latestSeq);

        // Each copy is a genuine encrypted task update with a distinct ID and
        // advancing vector clock. The production server accepts and pages them.
        const seedClientId = `backlog_8763_${testRunId}`;
        await seedBacklog(
          user.token,
          seedClientId,
          SuperSyncOperationSchema.parse(source),
          historyClock,
        );
        await clientA.sync.syncAndWait({ timeout: 90000 });
        await clientA.workView.addTask(finalTask);
        await clientA.sync.syncAndWait({ timeout: 90000 });
        const finalServerSeq = (await getServerHistory(user.token)).latestSeq;
        expect(finalServerSeq).toBeGreaterThan(initialCursor + PAGE_CAP);
        await expect(clientB.page.locator(`task:has-text("${finalTask}")`)).toHaveCount(
          0,
        );

        const finalOp = resetServer
          ? SuperSyncOperationSchema.parse(
              (await getServerHistory(user.token, initialCursor + PAGE_CAP)).ops.find(
                ({ op }) => op.entityType === 'TASK' && op.opType === 'CRT',
              )?.op,
            )
          : undefined;
        if (resetServer && !finalOp)
          throw new Error('No genuine final task op to restore');
        let didReset = false;
        let resetHeadSeq = 0;

        const requestedSinceSeqs: number[] = [];
        const resetSinceSeqs: number[] = [];
        await routeSuperSyncOps(clientB.page, async (route) => {
          if (route.request().method() !== 'GET') {
            await route.continue();
            return;
          }
          const url = new URL(route.request().url());
          const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? 0);
          requestedSinceSeqs.push(sinceSeq);
          const isResetFollowup =
            resetServer && !didReset && sinceSeq === initialCursor + PAGE_CAP;
          if (isResetFollowup) {
            didReset = true;
            // Rewind this user's real server history after B has checkpointed
            // the first pass. The replacement head stays below the old cursor.
            await wipeUserSyncData(user.token, user.userId);
            await seedBacklog(
              user.token,
              `reset_8763_${testRunId}`,
              SuperSyncOperationSchema.parse(source),
              {
                ...historyClock,
                [seedClientId]: PAGE_CAP + 1,
              },
              PAGE_CAP,
            );
            if (finalOp) await uploadSavedOp(user.token, finalOp);
            resetHeadSeq = (await getServerHistory(user.token)).latestSeq;
            expect(resetHeadSeq).toBeLessThan(sinceSeq);
          } else if (didReset) {
            resetSinceSeqs.push(sinceSeq);
          }
          url.searchParams.set('limit', '1');
          await route.continue({ url: url.toString() });
        });

        // One click only. The app must schedule its own next pass after the
        // thousandth page instead of waiting for a second manual sync.
        await clientB.sync.syncBtn.click();
        if (resetServer) {
          // The gap response consumes one of this pass's 1000 requests. After
          // page 999 the next request at seq 999 must come from the scheduler.
          await expect
            .poll(() => resetSinceSeqs.includes(PAGE_CAP - 2), { timeout: 180000 })
            .toBe(true);
          await expect
            .poll(() => resetSinceSeqs.includes(PAGE_CAP - 1), { timeout: 30000 })
            .toBe(true);
        }
        await expect(clientB.page.locator(`task:has-text("${finalTask}")`)).toBeVisible({
          timeout: resetServer ? 30000 : 180000,
        });
        expect(requestedSinceSeqs[0]).toBe(initialCursor);
        expect(requestedSinceSeqs).toContain(initialCursor + PAGE_CAP);
        if (resetServer) {
          expect(didReset).toBe(true);
          expect(requestedSinceSeqs).toContain(0);
        }
        await expect
          .poll(() => getCursor(clientB!), { timeout: 30000 })
          .toBeGreaterThanOrEqual(resetServer ? resetHeadSeq : finalServerSeq);
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
        if (userId !== undefined) await deleteTestUser(userId);
      }
    });
  }
});
