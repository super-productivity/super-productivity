import {
  CURRENT_SCHEMA_VERSION,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncUploadOpsRequestSchema,
  SuperSyncUploadOpsResponseSchema,
  type SuperSyncOperation,
} from '@sp/shared-schema';
import { encrypt } from '@sp/sync-core';
import type { Dialog, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import { SettingsPage } from '../../pages/settings.page';
import { normalizeDialogMessage, translationRegex } from '../../utils/i18n-strings';
import {
  SUPERSYNC_BASE_URL,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  routeSuperSyncOps,
  unrouteSuperSyncOps,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

interface ObservedDownloadPage {
  sinceSeq: number;
  hasMore: boolean;
  opIds: string[];
}

type DownloadHistory = ReturnType<typeof SuperSyncDownloadOpsResponseSchema.parse>;

interface CorruptSuffix {
  opId: string;
  serverSeq: number;
  encryptedPayload: string;
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

const mergeHistoryClock = (history: DownloadHistory): Record<string, number> => {
  const merged: Record<string, number> = {};
  for (const { op } of history.ops) {
    for (const [clientId, counter] of Object.entries(op.vectorClock)) {
      merged[clientId] = Math.max(merged[clientId] ?? 0, counter);
    }
  }
  return merged;
};

const corruptAuthenticationTag = (ciphertext: string): string => {
  const bytes = Buffer.from(ciphertext, 'base64');
  if (bytes.length === 0) throw new Error('Cannot corrupt an empty ciphertext');
  bytes[bytes.length - 1] ^= 1;
  return bytes.toString('base64');
};

const uploadCorruptSuffix = async (
  token: string,
  testRunId: string,
  password: string,
  history: DownloadHistory,
): Promise<CorruptSuffix> => {
  const clientId = `issue-9256-seed-${testRunId}`;
  const encryptedPayload = corruptAuthenticationTag(
    await encrypt(JSON.stringify({ project: {}, tag: {} }), password),
  );
  const corruptOp: SuperSyncOperation = {
    id: crypto.randomUUID(),
    clientId,
    actionType: '[TIME_TRACKING] LWW Update',
    opType: 'UPD',
    entityType: 'TIME_TRACKING',
    entityId: 'PROJECT:issue-9256:2026-03-24',
    payload: encryptedPayload,
    vectorClock: { ...mergeHistoryClock(history), [clientId]: 1 },
    timestamp: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    isPayloadEncrypted: true,
  };
  const requestBody = SuperSyncUploadOpsRequestSchema.parse({
    clientId,
    ops: [corruptOp],
  });
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to seed corrupt operation: ${response.status} ${await response.text()}`,
    );
  }

  const result = SuperSyncUploadOpsResponseSchema.parse(await response.json());
  if (result.results.length !== 1 || result.results[0].accepted !== true) {
    throw new Error(`Server rejected corrupt fixture: ${JSON.stringify(result)}`);
  }
  const serverSeq = result.results[0].serverSeq;
  if (serverSeq === undefined) {
    throw new Error('Server accepted corrupt fixture without assigning a serverSeq');
  }
  return {
    opId: corruptOp.id,
    serverSeq,
    encryptedPayload,
  };
};

const containsFailureSequence = (
  pages: ObservedDownloadPage[],
  validPageOpIds: string[],
  corruptOpId: string,
): boolean =>
  pages.some(
    (page, index) =>
      page.sinceSeq === 0 &&
      page.hasMore &&
      page.opIds.join() === validPageOpIds.join() &&
      pages[index + 1]?.hasMore === false &&
      pages[index + 1]?.opIds.join() === corruptOpId,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

// Strict key sets: a regression that adds an extra field (worst case a
// payload sample) must fail here, not slip through a partial match.
const isExpectedDiagnosticSummary = (
  value: unknown,
  decryptedOpsInEarlierBatches: number,
  passwordEvidence: string,
): boolean =>
  isRecord(value) &&
  hasExactKeys(value, [
    'encryptedOperationCount',
    'decryptedCount',
    'parsedCount',
    'decryptedOpsInEarlierBatches',
    'passwordEvidence',
    'failureCount',
  ]) &&
  // The failing batch is the lone corrupt op on the final page; pages decrypted
  // before it IN THE SAME RUN are what prove the password is not globally wrong.
  value.encryptedOperationCount === 1 &&
  value.decryptedCount === 0 &&
  value.parsedCount === 0 &&
  value.decryptedOpsInEarlierBatches === decryptedOpsInEarlierBatches &&
  value.passwordEvidence === passwordEvidence &&
  value.failureCount === 1;

const isExpectedDiagnosticFailure = (
  value: unknown,
  corruptSuffix: CorruptSuffix,
): boolean =>
  isRecord(value) &&
  hasExactKeys(value, [
    'opId',
    'encryptedBatchIndex',
    'stage',
    'errorName',
    'serverSeq',
  ]) &&
  value.opId === corruptSuffix.opId &&
  value.serverSeq === corruptSuffix.serverSeq &&
  value.encryptedBatchIndex === 0 &&
  value.stage === 'decrypt' &&
  // AES-GCM auth failure — corruption/wrong key, not an environment failure.
  value.errorName === 'OperationError';

const countExpectedDiagnosticLogs = (
  value: unknown,
  corruptSuffix: CorruptSuffix,
  decryptedOpsInEarlierBatches: number,
  passwordEvidence: string,
): number => {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.filter((entry: unknown) => {
    if (!isRecord(entry)) {
      return false;
    }
    return (
      entry.context === 'ol' &&
      entry.message ===
        'OperationLogDownloadService: Encrypted operation batch could not be processed.' &&
      Array.isArray(entry.args) &&
      entry.args.some((arg: unknown) =>
        isExpectedDiagnosticSummary(arg, decryptedOpsInEarlierBatches, passwordEvidence),
      ) &&
      entry.args.some((arg: unknown) => isExpectedDiagnosticFailure(arg, corruptSuffix))
    );
  }).length;
};

// After a kept prefix the cursor sits at the last valid op, so a retry asks for
// the corrupt op alone instead of re-downloading the history from seq 0.
const resumesAtCorruptOp = (
  pages: ObservedDownloadPage[],
  cursorSeq: number,
  corruptOpId: string,
): boolean =>
  pages.length > 0 &&
  pages.every((page) => page.sinceSeq !== 0) &&
  pages.some(
    (page) =>
      page.sinceSeq === cursorSeq &&
      page.hasMore === false &&
      page.opIds.join() === corruptOpId,
  );

const FRESH_CLIENT_CONFIRM = translationRegex(
  'F.SYNC.D_FRESH_CLIENT_CONFIRM.TITLE',
  'F.SYNC.D_FRESH_CLIENT_CONFIRM.MESSAGE',
);

// setupSuperSync({ waitForInitialSync: false }) can return before the kept
// prefix reaches the fresh-client confirmation, and Playwright dismisses an
// unhandled confirm, which would decline the prefix. Accept that one prompt for
// the whole test; setupSuperSync tolerates a second listener on the same dialog.
const acceptFreshClientConfirm = (page: Page): (() => void) => {
  const handler = async (dialog: Dialog): Promise<void> => {
    if (
      dialog.type() === 'confirm' &&
      FRESH_CLIENT_CONFIRM.test(normalizeDialogMessage(dialog.message()))
    ) {
      await dialog.accept().catch(() => {});
    }
  };
  page.on('dialog', handler);
  return () => page.off('dialog', handler);
};

test.describe('@supersync @encryption #9256 final-page decrypt failure', () => {
  test('keeps the pages that decrypted and still reports the undecryptable final op', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(150000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let stopAcceptingFreshConfirm: (() => void) | null = null;

    try {
      const user = await createTestUser(testRunId);
      const encryptionPassword = `issue-9256-${testRunId}`;
      const syncConfig = {
        ...getSuperSyncConfig(user),
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };
      const taskName = `Valid-page-task-${testRunId}`;

      // The valid first page is a genuine encrypted full-state operation produced
      // by the app, not a fabricated response or a mocked crypto service.
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      await clientA.workView.addTask(taskName);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      const validHistory = await downloadServerHistory(user.token);
      expect(validHistory.ops.length).toBeGreaterThan(0);
      expect(validHistory.hasMore).toBe(false);
      expect(
        validHistory.ops.every(
          ({ op }) => op.isPayloadEncrypted === true && typeof op.payload === 'string',
        ),
      ).toBe(true);
      expect(validHistory.ops.some(({ op }) => op.opType === 'SYNC_IMPORT')).toBe(true);
      const validPageOpIds = validHistory.ops.map(({ op }) => op.id);
      const lastValidSeq = validHistory.ops[validHistory.ops.length - 1].serverSeq;
      const corruptSuffix = await uploadCorruptSuffix(
        user.token,
        testRunId,
        encryptionPassword,
        validHistory,
      );
      await closeClient(clientA);
      clientA = null;

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      const observedPages: ObservedDownloadPage[] = [];
      await routeSuperSyncOps(clientB.page, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        // Ask the real server to put the valid history and corrupt suffix on
        // separate pages. The response itself is passed through unchanged.
        const url = new URL(route.request().url());
        const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? 0);
        url.searchParams.set('limit', String(validHistory.ops.length));
        const response = await route.fetch({ url: url.toString() });
        const body = SuperSyncDownloadOpsResponseSchema.parse(await response.json());
        observedPages.push({
          sinceSeq,
          hasMore: body.hasMore,
          opIds: body.ops.map(({ op }) => op.id),
        });
        await route.fulfill({ response });
      });

      stopAcceptingFreshConfirm = acceptFreshClientConfirm(clientB.page);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        waitForInitialSync: false,
      });

      // The dialog appears in the SAME cycle that applied the prefix: the
      // failing page is reported, not hidden behind an IN_SYNC status.
      const decryptErrorDialog = clientB.page.locator('dialog-handle-decrypt-error');
      await expect(decryptErrorDialog).toBeVisible({ timeout: 30000 });
      await expect(
        decryptErrorDialog.locator('h2:has-text("Decryption Failed")'),
      ).toBeVisible();
      await expect
        .poll(() =>
          containsFailureSequence(observedPages, validPageOpIds, corruptSuffix.opId),
        )
        .toBe(true);
      expect(await clientB.sync.hasSyncError()).toBe(true);

      // #9256: the page that decrypted is kept instead of discarded.
      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible();

      // Retrying resumes at the persisted cursor (the last valid op) and fails
      // on the corrupt op alone; the kept data stays.
      const retryPagesStart = observedPages.length;
      await decryptErrorDialog.locator('input[type="password"]').fill(encryptionPassword);
      await decryptErrorDialog
        .locator('button')
        .filter({ hasText: /retry.*decrypt/i })
        .click();

      await expect
        .poll(
          () =>
            resumesAtCorruptOp(
              observedPages.slice(retryPagesStart),
              lastValidSeq,
              corruptSuffix.opId,
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      await expect(decryptErrorDialog).toBeVisible({ timeout: 30000 });
      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible();

      await decryptErrorDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(decryptErrorDialog).not.toBeVisible();

      const settingsPage = new SettingsPage(clientB.page);
      await settingsPage.navigateToSettings();
      await clientB.page.getByRole('link', { name: 'Logs', exact: true }).click();
      const logsTextarea = clientB.page.locator('dialog-logs textarea.logs-textarea');
      await expect(logsTextarea).toHaveValue(/^\s*\[[\s\S]*\]\s*$/);
      const exportedLogsText = await logsTextarea.inputValue();
      const exportedLogs: unknown = JSON.parse(exportedLogsText);

      // The first run decrypted the valid page before failing, which proves the
      // password; the retry starts at the corrupt op, so it has no such evidence.
      expect(
        countExpectedDiagnosticLogs(
          exportedLogs,
          corruptSuffix,
          validPageOpIds.length,
          'confirmed-for-some-operations',
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(
        countExpectedDiagnosticLogs(
          exportedLogs,
          corruptSuffix,
          0,
          'no-operation-decrypted',
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(exportedLogsText).not.toContain(user.token);
      expect(exportedLogsText).not.toContain(encryptionPassword);
      expect(exportedLogsText).not.toContain(corruptSuffix.encryptedPayload);
      for (const { op } of validHistory.ops) {
        expect(exportedLogsText).not.toContain(op.payload as string);
      }
      expect(exportedLogsText).not.toContain(taskName);
    } finally {
      stopAcceptingFreshConfirm?.();
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await unrouteSuperSyncOps(clientB.page).catch(() => {});
        await closeClient(clientB);
      }
    }
  });

  test('offers no server overwrite from the stuck client and leaves the server copy intact', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(150000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let stopAcceptingFreshConfirm: (() => void) | null = null;

    try {
      const user = await createTestUser(testRunId);
      const encryptionPassword = `issue-9256-refusal-${testRunId}`;
      const syncConfig = {
        ...getSuperSyncConfig(user),
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };
      const taskName = `Server-only-task-${testRunId}`;

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      await clientA.workView.addTask(taskName);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      const validHistory = await downloadServerHistory(user.token);
      expect(validHistory.ops.length).toBeGreaterThan(0);
      const opIdsBefore = validHistory.ops.map(({ op }) => op.id).sort();
      const corruptSuffix = await uploadCorruptSuffix(
        user.token,
        testRunId,
        encryptionPassword,
        validHistory,
      );
      await closeClient(clientA);
      clientA = null;

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      stopAcceptingFreshConfirm = acceptFreshClientConfirm(clientB.page);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        waitForInitialSync: false,
      });

      const decryptErrorDialog = clientB.page.locator('dialog-handle-decrypt-error');
      await expect(decryptErrorDialog).toBeVisible({ timeout: 30000 });

      // The kept prefix makes this device look like any synced device, so the
      // #9931 "holds nothing" refusal can no longer protect the unreadable
      // suffix. The dialog therefore offers no overwrite at all: it cannot tell
      // a wrong password from a corrupt or foreign-key op.
      await expect(
        decryptErrorDialog.locator('button').filter({ hasText: /overwrite/i }),
      ).toHaveCount(0);

      await decryptErrorDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(decryptErrorDialog).not.toBeVisible();

      // Every server operation is still there, corrupt suffix included.
      const historyAfter = await downloadServerHistory(user.token);
      const opIdsAfter = historyAfter.ops.map(({ op }) => op.id).sort();
      expect(opIdsAfter).toEqual([...opIdsBefore, corruptSuffix.opId].sort());
    } finally {
      stopAcceptingFreshConfirm?.();
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
