import {
  SuperSyncDownloadOpsResponseSchema,
  type SuperSyncOperation,
} from '@sp/shared-schema';
import { decrypt } from '@sp/sync-core';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  routeSuperSyncOps,
  SUPERSYNC_BASE_URL,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';

type DownloadHistory = ReturnType<typeof SuperSyncDownloadOpsResponseSchema.parse>;

interface SeededPlaintextOperation {
  id: string;
  serverSeq: number;
}

interface RawServerOperation {
  id: string;
  opType: string;
  serverSeq: number;
}

const authHeaders = (token: string): Headers => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  return headers;
};

const downloadServerHistory = async (token: string): Promise<DownloadHistory> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=0&limit=1000`,
    { headers: authHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to inspect SuperSync history: ${response.status} ${await response.text()}`,
    );
  }
  return SuperSyncDownloadOpsResponseSchema.parse(await response.json());
};

const downloadRawServerOps = async (userId: number): Promise<RawServerOperation[]> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=100`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to inspect raw server operations: ${response.status} ${await response.text()}`,
    );
  }
  return ((await response.json()) as { ops: RawServerOperation[] }).ops;
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
 * Reuses a genuine app-created encrypted TASK operation, decrypts its payload,
 * and inserts the same wire shape through the TEST_MODE database seed route.
 * This models legacy plaintext history without weakening the production upload
 * gate that prevents new plaintext from being stored.
 */
const seedPlaintextClone = async (
  userId: number,
  password: string,
  testRunId: string,
  history: DownloadHistory,
): Promise<SeededPlaintextOperation> => {
  const source = history.ops.find(
    ({ op }) =>
      op.entityType === 'TASK' &&
      op.isPayloadEncrypted === true &&
      typeof op.payload === 'string',
  )?.op;
  if (!source || typeof source.payload !== 'string') {
    throw new Error('No encrypted TASK operation available for the plaintext seed');
  }

  const clientId = `issue-9439-seed-${testRunId}`;
  const plaintextOp: SuperSyncOperation = {
    ...source,
    id: crypto.randomUUID(),
    clientId,
    payload: JSON.parse(await decrypt(source.payload, password)),
    vectorClock: { ...mergeHistoryClock(history), [clientId]: 1 },
    timestamp: Date.now(),
    isPayloadEncrypted: false,
  };
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/legacy-plaintext-ops`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ op: plaintextOp }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to seed plaintext operation: ${response.status} ${await response.text()}`,
    );
  }

  const result: unknown = await response.json();
  if (
    typeof result !== 'object' ||
    result === null ||
    !('id' in result) ||
    result.id !== plaintextOp.id ||
    !('serverSeq' in result) ||
    typeof result.serverSeq !== 'number' ||
    !Number.isSafeInteger(result.serverSeq) ||
    result.serverSeq < 1
  ) {
    throw new Error(`Invalid plaintext seed response: ${JSON.stringify(result)}`);
  }
  return { id: plaintextOp.id, serverSeq: result.serverSeq };
};

const forceOverwriteFromTrustedClient = async (
  client: SimulatedE2EClient,
): Promise<void> => {
  await client.sync.syncBtn.click({ button: 'right', noWaitAfter: true });
  await client.sync.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

  const forceOverwriteButton = client.page.getByRole('button', {
    name: 'Force Overwrite',
    exact: true,
  });
  if (!(await forceOverwriteButton.isVisible().catch(() => false))) {
    await client.page
      .locator('.collapsible-header')
      .filter({ hasText: 'Advanced' })
      .click();
  }
  await expect(forceOverwriteButton).toBeVisible();

  client.page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('REPLACE all data on the server');
    try {
      await dialog.accept();
    } catch {
      // setupSuperSync also guards native confirmations and may win this race.
    }
  });
  await forceOverwriteButton.click();
};

test.describe('@supersync @encryption #9439 plaintext history recovery', () => {
  test('trusted-client force overwrite restores a fresh client without accepting plaintext', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    let trustedClient: SimulatedE2EClient | null = null;
    let freshClient: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const password = `issue-9439-${testRunId}`;
      const syncConfig = {
        ...getSuperSyncConfig(user),
        isEncryptionEnabled: true,
        password,
      };
      const preservedTask = `Preserved-${testRunId}`;

      trustedClient = await createSimulatedClient(
        browser,
        baseURL!,
        'trusted',
        testRunId,
      );
      await trustedClient.sync.setupSuperSync(syncConfig);
      await trustedClient.workView.addTask(preservedTask);
      await trustedClient.sync.syncAndWait();

      const validHistory = await downloadServerHistory(user.token);
      const plaintextOp = await seedPlaintextClone(
        user.userId,
        password,
        testRunId,
        validHistory,
      );

      freshClient = await createSimulatedClient(browser, baseURL!, 'fresh', testRunId);
      const requestedSinceSeqs: number[] = [];
      await routeSuperSyncOps(freshClient.page, async (route) => {
        if (route.request().method() === 'GET') {
          const url = new URL(route.request().url());
          requestedSinceSeqs.push(Number(url.searchParams.get('sinceSeq') ?? 0));
          url.searchParams.set('limit', '1');
          await route.continue({ url: url.toString() });
          return;
        }
        await route.continue();
      });

      await freshClient.sync.setupSuperSync({
        ...syncConfig,
        waitForInitialSync: false,
      });

      await expect(freshClient.sync.syncErrorIcon).toBeVisible({ timeout: 30000 });
      await expect(
        freshClient.page.locator(`task:has-text("${preservedTask}")`),
      ).not.toBeVisible();
      expect(requestedSinceSeqs).toContain(plaintextOp.serverSeq - 1);
      const zeroRequestsBeforeExplicitRetry = requestedSinceSeqs.filter(
        (sinceSeq) => sinceSeq === 0,
      ).length;
      await freshClient.sync.syncBtn.click();
      await expect
        .poll(() => requestedSinceSeqs.filter((sinceSeq) => sinceSeq === 0).length, {
          timeout: 30000,
        })
        .toBeGreaterThan(zeroRequestsBeforeExplicitRetry);
      await expect(
        freshClient.page.locator(`task:has-text("${preservedTask}")`),
      ).not.toBeVisible();
      expect(
        (await downloadRawServerOps(user.userId)).some(({ id }) => id === plaintextOp.id),
      ).toBe(true);

      const integritySnack = freshClient.page.locator('snack-custom', {
        hasText: 'security integrity check',
      });
      await expect(integritySnack).toBeVisible({ timeout: 30000 });
      await expect(integritySnack.locator('button.action')).toHaveCount(0);
      await expect(integritySnack).toContainText('export a backup');
      await expect(integritySnack).toContainText('Force Overwrite');

      await forceOverwriteFromTrustedClient(trustedClient);
      await expect
        .poll(
          async () => {
            const [history, rawOps] = await Promise.all([
              downloadServerHistory(user.token),
              downloadRawServerOps(user.userId),
            ]);
            return (
              !rawOps.some(({ id }) => id === plaintextOp.id) &&
              history.latestSeq > plaintextOp.serverSeq &&
              history.ops.every(({ op }) => op.isPayloadEncrypted === true) &&
              history.ops.some(
                ({ op, serverSeq }) =>
                  op.opType === 'SYNC_IMPORT' &&
                  op.isPayloadEncrypted === true &&
                  serverSeq > plaintextOp.serverSeq,
              )
            );
          },
          { timeout: 60000 },
        )
        .toBe(true);

      const recoveredHistory = await downloadServerHistory(user.token);
      expect(recoveredHistory.ops.every(({ op }) => op.isPayloadEncrypted === true)).toBe(
        true,
      );
      expect(recoveredHistory.latestSeq).toBeGreaterThan(plaintextOp.serverSeq);

      await trustedClient.page.keyboard.press('Escape');
      await freshClient.sync.syncAndWait();
      await waitForTask(freshClient.page, preservedTask);
      await expect(freshClient.sync.syncErrorIcon).not.toBeVisible();
    } finally {
      if (trustedClient) await closeClient(trustedClient);
      if (freshClient) await closeClient(freshClient);
    }
  });
});
