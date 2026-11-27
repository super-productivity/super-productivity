import { readFileSync } from 'node:fs';
import { type Page } from '@playwright/test';
import {
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsResponseSchema,
  type SuperSyncOperation,
} from '@sp/shared-schema/supersync-http-contract';
import { decrypt, encrypt } from '@sp/sync-core';
import { expect, test } from '../../fixtures/supersync.fixture';
import { ImportPage } from '../../pages/import.page';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';
import {
  archiveTask,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  navigateToWorkView,
  renameTask,
  routeSuperSyncOps,
  SUPERSYNC_BASE_URL,
  type SimulatedE2EClient,
  type TestUser,
  waitForTask,
} from '../../utils/supersync-helpers';

// v18.14.0 is the last release without the plaintext download guard (added in
// v18.15.0). Bundle: scripts/fetch-released-client-assets.sh.
const preGuardAssets = process.env.COMPAT_PRE_GUARD_ASSETS;
// More than the app's DOWNLOAD_PAGE_SIZE (500), as on the reported account.
const BACKLOG_OPS = 600;

type DownloadHistory = ReturnType<typeof SuperSyncDownloadOpsResponseSchema.parse>;

interface SeededPlaintextOperation {
  id: string;
  serverSeq: number;
}

/** Replaces the cloned operation and its decrypted payload for one seed. */
interface PlaintextSeedVariant {
  source: SuperSyncOperation;
  rewritePayload: (payloadJson: string) => string;
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
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=1000`,
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
  variant?: PlaintextSeedVariant,
): Promise<SeededPlaintextOperation> => {
  const source =
    variant?.source ??
    history.ops.find(
      ({ op }) =>
        op.entityType === 'TASK' &&
        op.isPayloadEncrypted === true &&
        typeof op.payload === 'string',
    )?.op;
  if (!source || typeof source.payload !== 'string') {
    throw new Error('No encrypted TASK operation available for the plaintext seed');
  }

  const clientId = `issue-9439-seed-${testRunId}`;
  const plaintextOp = SuperSyncOperationSchema.parse({
    ...source,
    id: crypto.randomUUID(),
    clientId,
    payload: JSON.parse(
      (variant?.rewritePayload ?? ((json) => json))(
        await decrypt(source.payload, password),
      ),
    ),
    vectorClock: { ...mergeHistoryClock(history), [clientId]: 1 },
    timestamp: Date.now(),
    isPayloadEncrypted: false,
  });
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

/** The genuine app-created task update that set the given title. */
const findEncryptedTaskUpdate = async (
  history: DownloadHistory,
  password: string,
  title: string,
): Promise<SuperSyncOperation> => {
  for (const { op } of history.ops) {
    if (
      op.entityType === 'TASK' &&
      op.opType === 'UPD' &&
      op.isPayloadEncrypted === true &&
      typeof op.payload === 'string' &&
      (await decrypt(op.payload, password)).includes(title)
    ) {
      return SuperSyncOperationSchema.parse(op);
    }
  }
  throw new Error('No encrypted TASK update found for the given title');
};

/**
 * Uploads encrypted operations through the production endpoint, in order and
 * after everything in `history`, so the account continues past the plaintext
 * row as a real one does.
 */
const uploadEncryptedOps = async (
  token: string,
  history: DownloadHistory,
  sources: SuperSyncOperation[],
): Promise<void> => {
  const clientId = `issue-9439-later-${crypto.randomUUID().slice(0, 8)}`;
  const historyClock = mergeHistoryClock(history);
  const ops = sources.map((source, index) => ({
    ...source,
    id: crypto.randomUUID(),
    clientId,
    vectorClock: { ...historyClock, [clientId]: index + 1 },
    timestamp: Date.now(),
  }));
  for (let offset = 0; offset < ops.length; offset += SUPER_SYNC_MAX_OPS_PER_UPLOAD) {
    const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        clientId,
        ops: ops.slice(offset, offset + SUPER_SYNC_MAX_OPS_PER_UPLOAD),
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to upload encrypted operations: ${response.status}`);
    }
    const result = SuperSyncUploadOpsResponseSchema.parse(await response.json());
    expect(result.results.every((entry) => entry.accepted)).toBe(true);
  }
};

/** Exports a backup through the settings page and returns its archived task titles. */
const exportBackup = async (
  page: Page,
  filePath: string,
): Promise<{ archivedTitles: string[] }> => {
  const imex = new ImportPage(page);
  await imex.navigateToImportPage();
  const download = page.waitForEvent('download');
  await imex.exportBackupBtn.click();
  await (await download).saveAs(filePath);
  const backup = JSON.parse(readFileSync(filePath, 'utf8')) as {
    data?: { archiveYoung?: { task?: { entities?: Record<string, { title: string }> } } };
  };
  return {
    archivedTitles: Object.values(backup.data?.archiveYoung?.task?.entities ?? {}).map(
      ({ title }) => title,
    ),
  };
};

/** Waits until an encrypted full-state upload has replaced the mixed history. */
const expectHistoryReplacedWithoutPlaintext = async (
  user: TestUser,
  plaintextOp: SeededPlaintextOperation,
): Promise<void> => {
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
      await expectHistoryReplacedWithoutPlaintext(user, plaintextOp);

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

// The reporter's case: the only install with the data is gone, so no trusted
// current client exists. Skips without the released bundle; the scheduled
// workflow's released-client job supplies it.
test.describe('@supersync @encryption #9439 recovery without a trusted client', () => {
  test.skip(
    !preGuardAssets,
    'Set COMPAT_PRE_GUARD_ASSETS to the unmodified v18.14.0 assets',
  );
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;

  test.beforeAll(async () => {
    // A free port: other released suites may serve their bundle concurrently.
    assets = await serveReleasedClientAssets(
      { old: preGuardAssets!, new: preGuardAssets! },
      0,
    );
  });
  test.afterAll(async () => assets?.close());

  test('v18.14.0 downloads the mixed history and its backup restores the account', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    test.setTimeout(300000);
    const clients: SimulatedE2EClient[] = [];

    try {
      const user = await createTestUser(testRunId);
      const password = `issue-9439-${testRunId}`;
      const syncConfig = {
        ...getSuperSyncConfig(user),
        isEncryptionEnabled: true,
        password,
      };
      const alphaTask = `Alpha-${testRunId}`;
      const alphaEdited = `Alpha-edited-${testRunId}`;
      const betaTask = `Beta-${testRunId}`;
      const betaEdited = `Beta-edited-${testRunId}`;
      const archivedTask = `Gamma-archived-${testRunId}`;
      const isArchivedTask = (title: string): boolean => title.includes(archivedTask);
      // Each exists in exactly one operation: the plaintext row, and the last
      // row of the history, which lies beyond the first download page.
      const plaintextOnlyTitle = `Alpha-plaintext-only-${testRunId}`;
      const beyondFirstPageTitle = `Beta-beyond-first-page-${testRunId}`;

      // The install that no longer exists: it is never used after seeding.
      const lostClient = await createSimulatedClient(
        browser,
        baseURL!,
        'lost',
        testRunId,
      );
      clients.push(lostClient);
      await lostClient.sync.setupSuperSync(syncConfig);
      await lostClient.workView.addTask(archivedTask);
      await archiveTask(lostClient, archivedTask);
      await navigateToWorkView(lostClient);
      await lostClient.workView.addTask(alphaTask);
      await lostClient.workView.addTask(betaTask);
      await lostClient.sync.syncAndWait();
      await renameTask(lostClient, alphaTask, alphaEdited);
      await renameTask(lostClient, betaTask, betaEdited);
      await lostClient.sync.syncAndWait();

      let history = await downloadServerHistory(user.token);
      const plaintextOp = await seedPlaintextClone(
        user.userId,
        password,
        testRunId,
        history,
        {
          source: await findEncryptedTaskUpdate(history, password, alphaEdited),
          rewritePayload: (json) => json.replaceAll(alphaEdited, plaintextOnlyTitle),
        },
      );
      const betaUpdate = await findEncryptedTaskUpdate(history, password, betaEdited);
      if (typeof betaUpdate.payload !== 'string') throw new Error('Not encrypted');
      history = await downloadServerHistory(user.token);
      await uploadEncryptedOps(user.token, history, [
        ...Array.from({ length: BACKLOG_OPS }, () => betaUpdate),
        {
          ...betaUpdate,
          payload: await encrypt(
            (await decrypt(betaUpdate.payload, password)).replaceAll(
              betaEdited,
              beyondFirstPageTitle,
            ),
            password,
          ),
        },
      ]);
      expect((await downloadServerHistory(user.token)).latestSeq).toBeGreaterThan(
        BACKLOG_OPS,
      );

      // The current version cannot download the account: the guard rejects it.
      const stuckClient = await createSimulatedClient(
        browser,
        baseURL!,
        'stuck',
        testRunId,
      );
      clients.push(stuckClient);
      await stuckClient.sync.setupSuperSync({
        ...syncConfig,
        waitForInitialSync: false,
      });
      await expect(stuckClient.sync.syncErrorIcon).toBeVisible({ timeout: 60000 });
      await expect(stuckClient.page.locator(`task:has-text("${alphaTask}")`)).toHaveCount(
        0,
      );
      // Asserted after an explicit retry: the snack from the setup sync can
      // already be dismissed by the time setup returns.
      await stuckClient.sync.syncBtn.click();
      await expect(
        stuckClient.page.locator('snack-custom', {
          hasText: 'security integrity check',
        }),
      ).toBeVisible({ timeout: 30000 });

      // v18.14.0 downloads it with the same password and exports a backup.
      const preGuardClient = await createSimulatedClient(
        browser,
        assets.url,
        'pre-guard',
        testRunId,
        { serviceWorkers: 'block' },
      );
      clients.push(preGuardClient);
      await preGuardClient.sync.setupSuperSync(syncConfig);
      await preGuardClient.sync.syncAndWait({ timeout: 90000 });
      await waitForTask(preGuardClient.page, plaintextOnlyTitle);
      await waitForTask(preGuardClient.page, beyondFirstPageTitle);
      await expect(preGuardClient.sync.syncErrorIcon).not.toBeVisible();
      const backupPath = testInfo.outputPath('pre-guard-backup.json');
      const preGuardBackup = await exportBackup(preGuardClient.page, backupPath);
      expect(preGuardBackup.archivedTitles.some(isArchivedTask)).toBe(true);

      // The current version imports that backup and replaces the server copy.
      const importPage = new ImportPage(stuckClient.page);
      await importPage.navigateToImportPage();
      await importPage.importBackupFile(backupPath);
      await forceOverwriteFromTrustedClient(stuckClient);
      await expectHistoryReplacedWithoutPlaintext(user, plaintextOp);
      await stuckClient.page.keyboard.press('Escape');
      await navigateToWorkView(stuckClient);
      await waitForTask(stuckClient.page, plaintextOnlyTitle);
      await waitForTask(stuckClient.page, beyondFirstPageTitle);

      // Any further current install now syncs normally and has all of it.
      const freshClient = await createSimulatedClient(
        browser,
        baseURL!,
        'fresh',
        testRunId,
      );
      clients.push(freshClient);
      await freshClient.sync.setupSuperSync(syncConfig);
      await freshClient.sync.syncAndWait();
      await waitForTask(freshClient.page, plaintextOnlyTitle);
      await waitForTask(freshClient.page, beyondFirstPageTitle);
      await expect(freshClient.sync.syncErrorIcon).not.toBeVisible();
      const freshBackup = await exportBackup(
        freshClient.page,
        testInfo.outputPath('fresh-backup.json'),
      );
      expect(freshBackup.archivedTitles.some(isArchivedTask)).toBe(true);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
