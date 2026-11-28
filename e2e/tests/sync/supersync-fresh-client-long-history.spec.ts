import {
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsResponseSchema,
  type SuperSyncOperation,
} from '@sp/shared-schema/supersync-http-contract';
import { clearSessionKeyCache, decryptBatch, encryptBatch } from '@sp/sync-core';
import type { CDPSession, Page, Request } from '@playwright/test';
import { uuidv7 } from 'uuidv7';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  SUPERSYNC_BASE_URL,
  closeClient,
  createSimulatedClient,
  createTestUser,
  deleteTestUser,
  expectExactTaskTime,
  getSuperSyncConfig,
  getTaskTimeSpentFromState,
  isFullStateOpType,
  startTimeTracking,
  stopTimeTracking,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';
import {
  installIdbTransactionTiming,
  readIdbTransactionTiming,
  type IdbTransactionTiming,
} from '../../utils/idb-transaction-timing';

// Measurement, not a regression gate. Reported 2026-11-27: a fresh client on a
// long-history account downloaded ~69k ops after the newest SYNC_IMPORT
// (seq ~66k -> 134,906; 96% UPD) and needed two passes because of the 50k cap.
// This pins today's shape: no server snapshot, the whole post-import tail.
// Runs only on request (it seeds for ~7 min under the upload rate limit and
// syncs for many more): grep "@long-history" in the scheduled workflow, or set
// E2E_LONG_HISTORY_OPS locally, which also overrides the tail size.
const IS_REQUESTED =
  process.env.E2E_LONG_HISTORY_OPS !== undefined ||
  (process.env.E2E_GREP ?? '').includes('@long-history');
const TAIL_OPS = Number(process.env.E2E_LONG_HISTORY_OPS ?? 69_000);
const DOWNLOAD_CAP = 50_000; // MAX_DOWNLOAD_OPS_IN_MEMORY in the app
// Each app session encrypts with a fresh salt, and a fresh client derives one
// Argon2id key per salt (0.5-2 s each). Estimate, not measured: two devices
// restarting once a day over the five weeks of the reported tail.
const SEED_SESSIONS = 70;
// Several tracked tasks and devices taking turns, so the tail spans more
// entities and clocks carry several entries (a production tail had two
// devices; one task and one author made conflict checks unrealistically cheap).
const SEED_TASKS = 12;
const SEED_CLIENTS = 6;
const LOG_PREFIX = '[long-history-measure]';
const PHASE_MARKERS =
  /Starting download|Download limit reached|Downloaded ops breakdown|Applying \d+ remote operations|Finished applying operations|Applied and marked|APPLYING FULL-STATE/;

type DownloadHistory = ReturnType<typeof SuperSyncDownloadOpsResponseSchema.parse>;

interface PageRecord {
  sinceSeq: number;
  opCount: number;
  firstOpType?: string;
  startedAt: number;
  serverWaitMs: number;
  transferMs: number;
  totalMs: number;
  encodedBytes: number;
  decodedBytes: number;
}

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string } }[];
  samples: number[];
  timeDeltas: number[];
}

const jsonHeaders = (token: string): Headers => {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  headers.set('Content-Type', 'application/json');
  return headers;
};

const getServerHistory = async (token: string): Promise<DownloadHistory> => {
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=0`, {
    headers: jsonHeaders(token),
  });
  if (!response.ok) throw new Error(`History read failed: ${response.status}`);
  return SuperSyncDownloadOpsResponseSchema.parse(await response.json());
};

const getLatestSeq = async (token: string): Promise<number> => {
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=0&limit=1`, {
    headers: jsonHeaders(token),
  });
  if (!response.ok) throw new Error(`Latest seq read failed: ${response.status}`);
  return SuperSyncDownloadOpsResponseSchema.parse(await response.json()).latestSeq;
};

const getCursor = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith('super_sync_last_server_seq_'),
    );
    return Number(key ? localStorage.getItem(key) : 0);
  });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The per-user upload limit (100 requests/min) stays on in TEST_MODE, so a
// 429 means "wait for the window", not failure.
const uploadBatch = async (
  token: string,
  clientId: string,
  ops: SuperSyncOperation[],
): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ clientId, ops }),
    });
    if (response.status === 429) {
      await sleep(2000);
      continue;
    }
    if (!response.ok) throw new Error(`Seed upload failed: ${response.status}`);
    const result = SuperSyncUploadOpsResponseSchema.parse(await response.json());
    expect(result.results.every((entry) => entry.accepted)).toBe(true);
    return;
  }
  throw new Error('Seed upload stayed rate-limited for 2 minutes');
};

// The app re-salts once per process session; clearing the key cache does the
// same here, so every session's copies need their own key on download.
const encryptPerSession = async (
  templates: SuperSyncOperation[],
  password: string,
): Promise<string[][]> => {
  const ciphertexts = templates.map(({ payload }) => {
    if (typeof payload !== 'string') throw new Error('Encrypted payload is not a string');
    return payload;
  });
  const plaintexts = await decryptBatch(ciphertexts, password);
  const sessions: string[][] = [];
  for (let session = 0; session < SEED_SESSIONS; session++) {
    clearSessionKeyCache();
    sessions.push(await encryptBatch(plaintexts, password));
  }
  return sessions;
};

// Each copy is a genuine encrypted op the real app produced (time tracking),
// with a fresh UUIDv7 and an advancing clock, so the server stores, pages and
// serves it like production history. Devices take turns per batch, as a
// user's laptop and phone do; each op's clock covers everything before it.
// `total` is whole template cycles, so each task's time grows predictably.
const seedTail = async (
  token: string,
  seed: {
    clientIds: string[];
    templates: SuperSyncOperation[];
    sessionPayloads: string[][];
    baseClock: Record<string, number>;
    total: number;
  },
): Promise<void> => {
  const { templates, sessionPayloads, total } = seed;
  const clock = { ...seed.baseClock };
  for (let offset = 0; offset < total; offset += SUPER_SYNC_MAX_OPS_PER_UPLOAD) {
    const clientId =
      seed.clientIds[(offset / SUPER_SYNC_MAX_OPS_PER_UPLOAD) % seed.clientIds.length];
    const size = Math.min(SUPER_SYNC_MAX_OPS_PER_UPLOAD, total - offset);
    const ops = Array.from({ length: size }, (_, index): SuperSyncOperation => {
      const position = offset + index;
      const session = Math.floor((position * sessionPayloads.length) / total);
      clock[clientId] = (clock[clientId] ?? 0) + 1;
      return {
        ...templates[position % templates.length],
        id: uuidv7(),
        payload: sessionPayloads[session][position % templates.length],
        clientId,
        vectorClock: { ...clock },
        timestamp: Date.now(),
      };
    });
    await uploadBatch(token, clientId, ops);
  }
};

const mergeClock = (history: DownloadHistory): Record<string, number> => {
  const merged: Record<string, number> = {};
  for (const { op } of history.ops) {
    for (const [id, counter] of Object.entries(op.vectorClock)) {
      merged[id] = Math.max(merged[id] ?? 0, counter);
    }
  }
  return merged;
};

const recordPage = async (request: Request): Promise<PageRecord | null> => {
  const url = new URL(request.url());
  if (request.method() !== 'GET' || !url.pathname.endsWith('/api/sync/ops')) {
    return null;
  }
  const response = await request.response();
  if (!response?.ok()) return null;
  const body = await response.body();
  const parsed = JSON.parse(body.toString('utf8')) as {
    ops?: { op?: { opType?: string } }[];
  };
  const timing = request.timing();
  const sizes = await request.sizes();
  return {
    sinceSeq: Number(url.searchParams.get('sinceSeq')),
    opCount: parsed.ops?.length ?? 0,
    firstOpType: parsed.ops?.[0]?.op?.opType,
    startedAt: timing.startTime,
    serverWaitMs: timing.responseStart - timing.requestStart,
    transferMs: timing.responseEnd - timing.responseStart,
    totalMs: timing.responseEnd,
    encodedBytes: sizes.responseBodySize,
    decodedBytes: body.length,
  };
};

const summarizeProfile = (profile: CpuProfile): Record<string, unknown> => {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfMs = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const frame = nodes.get(id)?.callFrame;
    const file = frame?.url.split('/').pop() ?? '';
    const key = `${frame?.functionName || '(anonymous)'}${file ? ` @${file}` : ''}`;
    const sampleMs = (profile.timeDeltas[index] ?? 0) / 1000;
    selfMs.set(key, (selfMs.get(key) ?? 0) + sampleMs);
  });
  const totalMs = [...selfMs.values()].reduce((a, b) => a + b, 0);
  const pick = (name: string): number => Math.round(selfMs.get(name) ?? 0);
  const top = [...selfMs.entries()]
    .filter(([name]) => !['(idle)', '(program)', '(garbage collector)'].includes(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, ms]) => `${Math.round(ms)}ms ${name}`);
  return {
    totalMs: Math.round(totalMs),
    idleMs: pick('(idle)'),
    programMs: pick('(program)'),
    gcMs: pick('(garbage collector)'),
    topSelf: top,
  };
};

const startProfiling = async (page: Page, violations: string[]): Promise<CDPSession> => {
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.source === 'violation') violations.push(entry.text.slice(0, 120));
  });
  await cdp.send('Log.enable');
  // The thresholds DevTools uses for its "[Violation]" console lines.
  await cdp.send('Log.startViolationsReport', {
    config: [
      { name: 'handler', threshold: 150 },
      { name: 'longTask', threshold: 200 },
    ],
  });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 5000 });
  await cdp.send('Profiler.start');
  return cdp;
};

const summarizeViolations = (violations: string[]): Record<string, unknown> => {
  const tookMs = (text: string): number => Number(/took (\d+)ms/.exec(text)?.[1] ?? 0);
  const sorted = [...violations].sort((a, b) => tookMs(b) - tookMs(a));
  return {
    count: violations.length,
    totalMs: violations.reduce((total, text) => total + tookMs(text), 0),
    worst: sorted.slice(0, 5),
  };
};

// setupSuperSync enters the joiner's password itself; this only notes when the
// dialog opens and closes, around a real user's sync wait. null = never shown.
const watchPasswordDialog = (
  page: Page,
): Promise<{ shownAt: number; closedAt: number } | null> => {
  const dialog = page
    .locator('dialog-enter-encryption-password, dialog-handle-decrypt-error')
    .first();
  return dialog
    .waitFor({ state: 'visible', timeout: 180000 })
    .then(async () => {
      const shownAt = Date.now();
      await dialog.waitFor({ state: 'hidden', timeout: 180000 });
      return { shownAt, closedAt: Date.now() };
    })
    .catch(() => null);
};

// Real app activity: encryption setup leaves a SYNC_IMPORT on the server, and
// time tracking produces the encrypted UPD ops that dominate real tails (#11397).
// Returns each task's tracked time, which its synced deltas add up to.
const createAccountWithImport = async (
  client: SimulatedE2EClient,
  syncConfig: ReturnType<typeof getSuperSyncConfig>,
  taskNames: string[],
): Promise<number[]> => {
  await client.workView.waitForTaskList();
  for (const taskName of taskNames) await client.workView.addTask(taskName);
  await client.sync.setupSuperSync(syncConfig);
  for (const taskName of taskNames) {
    await startTimeTracking(client, taskName);
    await client.page.waitForTimeout(2000); // real elapsed time to track
    await stopTimeTracking(client, taskName);
  }
  await client.sync.syncAndWait();
  const tracked: number[] = [];
  for (const taskName of taskNames) {
    tracked.push((await getTaskTimeSpentFromState(client, taskName)) ?? 0);
  }
  return tracked;
};

// Relative to t0, so each op-log stage lines up with the phase markers.
const summarizeIdb = (
  timing: IdbTransactionTiming,
  t0: number,
): Record<string, unknown> => ({
  large: timing.large
    .filter((record) => record.startedAt >= t0 - 1000)
    .map(({ startedAt, ...record }) => ({
      at: +((startedAt - t0) / 1000).toFixed(1),
      ...record,
    })),
  small: timing.small,
});

const readSeedSource = async (
  token: string,
): Promise<{
  history: DownloadHistory;
  importSeq: number;
  templates: SuperSyncOperation[];
}> => {
  const history = await getServerHistory(token);
  const importOp = [...history.ops]
    .reverse()
    .find(({ op }) => isFullStateOpType(op.opType));
  if (!importOp) throw new Error('Setup produced no full-state op to start from');
  const templates = history.ops
    .filter(({ op }) => op.opType === 'UPD' && op.isPayloadEncrypted === true)
    .map(({ op }) => SuperSyncOperationSchema.parse(op));
  if (templates.length === 0) throw new Error('No genuine encrypted UPD op to seed');
  return { history, importSeq: importOp.serverSeq, templates };
};

const buildPageStats = (pages: PageRecord[]): Record<string, number> => {
  const sum = (pick: (r: PageRecord) => number): number =>
    Math.round(pages.reduce((total, record) => total + pick(record), 0));
  return {
    pages: pages.length,
    ops: sum((r) => r.opCount),
    serverWaitMs: sum((r) => r.serverWaitMs),
    transferMs: sum((r) => r.transferMs),
    requestTotalMs: sum((r) => r.totalMs),
    encodedMB: +(sum((r) => r.encodedBytes) / 1e6).toFixed(1),
    decodedMB: +(sum((r) => r.decodedBytes) / 1e6).toFixed(1),
  };
};

test.describe('@supersync @encryption @long-history fresh client on a long-history account', () => {
  test.describe.configure({ retries: 0 });
  test.skip(!IS_REQUESTED, 'Measurement run; grep "@long-history" to request it');

  test('downloads the whole post-import tail and reports where the time goes', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(48 * 60 * 1000); // the CI SuperSync job stops at 50 min
    expect(
      Number.isSafeInteger(TAIL_OPS) && TAIL_OPS > 0,
      'E2E_LONG_HISTORY_OPS must be a positive integer',
    ).toBe(true);
    let seeder: SimulatedE2EClient | null = null;
    let fresh: SimulatedE2EClient | null = null;
    let userId: number | undefined;

    try {
      const user = await createTestUser(testRunId);
      userId = user.userId;
      const password = `long-history-${testRunId}`;
      const syncConfig = { ...getSuperSyncConfig(user), password };
      // Zero-padded so no name is a prefix of another when located by text.
      const taskNames = Array.from(
        { length: SEED_TASKS },
        (_, index) => `Long-history-${testRunId}-${String(index + 1).padStart(2, '0')}`,
      );
      const taskName = taskNames[0];

      seeder = await createSimulatedClient(browser, baseURL!, 'seeder', testRunId);
      const tracked = await createAccountWithImport(seeder, syncConfig, taskNames);
      expect(tracked.every((ms) => ms > 0)).toBe(true);
      // Closed before seeding so its own syncs don't compete for the runner.
      await closeClient(seeder);
      seeder = null;
      const { history, importSeq, templates } = await readSeedSource(user.token);
      const cycles = Math.max(1, Math.round(TAIL_OPS / templates.length));
      const seededOps = cycles * templates.length;
      const seedStart = Date.now();
      await seedTail(user.token, {
        clientIds: Array.from(
          { length: SEED_CLIENTS },
          (_, index) => `long_history_seed${index}_${testRunId}`,
        ),
        templates,
        sessionPayloads: await encryptPerSession(templates, password),
        baseClock: mergeClock(history),
        total: seededOps,
      });
      const seedMs = Date.now() - seedStart;
      const latestSeq = await getLatestSeq(user.token);
      expect(latestSeq - history.latestSeq).toBe(seededOps);

      fresh = await createSimulatedClient(browser, baseURL!, 'fresh', testRunId);
      // The init script applies from the next load on, so reload once.
      await installIdbTransactionTiming(fresh.page);
      await fresh.page.reload();
      await fresh.workView.waitForTaskList();
      const pagePromises: Promise<PageRecord | null>[] = [];
      const phases: { t: number; text: string }[] = [];
      const violations: string[] = [];
      fresh.page.on('requestfinished', (request) => {
        pagePromises.push(recordPage(request));
      });
      fresh.page.on('console', (msg) => {
        const text = msg.text();
        if (PHASE_MARKERS.test(text))
          phases.push({ t: Date.now(), text: text.slice(0, 160) });
      });
      const cdp = await startProfiling(fresh.page, violations);

      const passwordWatch = watchPasswordDialog(fresh.page);
      const setupStart = Date.now();
      await fresh.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });
      const passwordDialog = await passwordWatch;
      const freshPage = fresh.page;
      await expect
        .poll(() => getCursor(freshPage), { timeout: 35 * 60 * 1000, intervals: [2000] })
        .toBeGreaterThanOrEqual(latestSeq);
      const syncedAt = Date.now();
      await waitForTask(freshPage, taskName);
      await expect(fresh.sync.syncErrorIcon).not.toBeVisible();

      const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
      const idbTiming = await readIdbTransactionTiming(freshPage);
      const pages = (await Promise.all(pagePromises)).filter(
        (record): record is PageRecord => record !== null,
      );
      // Requests from seq 0 before the dialog opened ended in it. The first one
      // after it opened is the real download (retries stay inside the window);
      // it can start before the dialog's close is observed, so it marks t0.
      const firstPage = pages.find(
        (record) =>
          record.sinceSeq === 0 && record.startedAt >= (passwordDialog?.shownAt ?? 0),
      );
      const t0 = firstPage?.startedAt ?? passwordDialog?.closedAt ?? setupStart;
      const wallMs = syncedAt - t0;
      const afterPassword = pages.filter((record) => record.startedAt >= t0);
      const download = buildPageStats(afterPassword);
      const passes = phases.filter(
        ({ t, text }) => t >= t0 && text.includes('Applied and marked'),
      ).length;

      const report = {
        tailOps: seededOps,
        seedSessions: SEED_SESSIONS,
        importSeq,
        latestSeq,
        seedTasks: SEED_TASKS,
        seedClients: SEED_CLIENTS,
        templateTypes: templates.map((op) => `${op.entityType}:${op.actionType}`),
        seedMs,
        // Measurement windows differ; wall, download and phases share t0.
        windows: {
          wall: 'first post-password seq-0 request -> cursor caught up',
          cpuAndViolations: 'setup start -> cursor caught up',
          idbLarge: 't0 - 1s -> cursor caught up',
          idbSmall: 'reload -> cursor caught up',
        },
        passwordDialogSeen: passwordDialog !== null,
        setupToPasswordMs: t0 - setupStart,
        t0ToPasswordClosedMs: passwordDialog ? passwordDialog.closedAt - t0 : null,
        beforePassword: buildPageStats(pages.filter((record) => record.startedAt < t0)),
        wallMs,
        passes,
        download,
        clientMs: wallMs - download.requestTotalMs,
        firstPage,
        violations: summarizeViolations(violations),
        phases: phases
          .filter(({ t }) => t >= t0 - 1000)
          .map(({ t, text }) => `+${((t - t0) / 1000).toFixed(1)}s ${text}`),
        cpu: summarizeProfile(profile),
        idb: summarizeIdb(idbTiming, t0),
      };
      console.log(`${LOG_PREFIX} ${JSON.stringify(report, null, 2)}`);
      await test.info().attach('long-history-report.json', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      // Today's behavior: the server starts at the account's only full-state op
      // (seq 1) and streams every op after it; no snapshot replaces the tail.
      // Skipping ahead to a later import is not exercised. A fix that serves a
      // snapshot or a compacted tail should flip these assertions.
      expect(firstPage?.firstOpType).toBe('SYNC_IMPORT');
      expect(download.ops).toBeGreaterThanOrEqual(latestSeq - importSeq + 1);
      if (seededOps > DOWNLOAD_CAP) expect(passes).toBeGreaterThanOrEqual(2);
      // Applied, not just downloaded: syncTimeSpent adds its delta, and each
      // whole template cycle carries every task's tracked delta once more.
      for (const [index, name] of taskNames.entries()) {
        await expectExactTaskTime(fresh, name, tracked[index] * (cycles + 1));
      }
    } finally {
      if (seeder) await closeClient(seeder);
      if (fresh) await closeClient(fresh);
      if (userId !== undefined) await deleteTestUser(userId);
    }
  });
});
