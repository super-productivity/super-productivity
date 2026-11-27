import {
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsResponseSchema,
  type SuperSyncOperation,
} from '@sp/shared-schema/supersync-http-contract';
import type { CDPSession, Page, Request } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  SUPERSYNC_BASE_URL,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  isFullStateOpType,
  startTimeTracking,
  stopTimeTracking,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';

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

// Each copy is a genuine encrypted op the real app produced (time tracking),
// with a fresh ID and an advancing clock, so the server stores, pages and
// serves it exactly like production history.
const seedTail = async (
  token: string,
  clientId: string,
  templates: SuperSyncOperation[],
  baseClock: Record<string, number>,
): Promise<void> => {
  for (let offset = 0; offset < TAIL_OPS; offset += SUPER_SYNC_MAX_OPS_PER_UPLOAD) {
    const size = Math.min(SUPER_SYNC_MAX_OPS_PER_UPLOAD, TAIL_OPS - offset);
    const ops = Array.from({ length: size }, (_, index): SuperSyncOperation => {
      const counter = offset + index + 1;
      return {
        ...templates[counter % templates.length],
        id: crypto.randomUUID(),
        clientId,
        vectorClock: { ...baseClock, [clientId]: counter },
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

// A joiner is asked for the password once the first encrypted page arrives.
// Returns the submit time, the moment a real user's sync wait starts.
const enterJoinerPassword = async (page: Page, password: string): Promise<number> => {
  const dialog = page
    .locator('dialog-enter-encryption-password, dialog-handle-decrypt-error')
    .first();
  await dialog.waitFor({ state: 'visible', timeout: 120000 });
  await dialog.locator('input[type="password"]').first().fill(password);
  const submittedAt = Date.now();
  await dialog.locator('button[mat-flat-button][color="primary"]').click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  return submittedAt;
};

// Real app activity: encryption setup leaves a SYNC_IMPORT on the server, and
// time tracking produces the encrypted UPD ops that dominate real tails.
const createAccountWithImport = async (
  client: SimulatedE2EClient,
  syncConfig: ReturnType<typeof getSuperSyncConfig>,
  taskName: string,
): Promise<void> => {
  await client.workView.waitForTaskList();
  await client.workView.addTask(taskName);
  await client.sync.setupSuperSync(syncConfig);
  await startTimeTracking(client, taskName);
  await client.page.waitForTimeout(3000); // real elapsed time to track
  await stopTimeTracking(client, taskName);
  await client.sync.syncAndWait();
};

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
    let seeder: SimulatedE2EClient | null = null;
    let fresh: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const password = `long-history-${testRunId}`;
      const syncConfig = { ...getSuperSyncConfig(user), password };
      const taskName = `Long-history-${testRunId}`;

      seeder = await createSimulatedClient(browser, baseURL!, 'seeder', testRunId);
      await createAccountWithImport(seeder, syncConfig, taskName);
      // Closed before seeding so its own syncs don't compete for the runner.
      await closeClient(seeder);
      seeder = null;
      const { history, importSeq, templates } = await readSeedSource(user.token);
      const seedStart = Date.now();
      await seedTail(
        user.token,
        `long_history_seed_${testRunId}`,
        templates,
        mergeClock(history),
      );
      const seedMs = Date.now() - seedStart;
      const latestSeq = await getLatestSeq(user.token);

      fresh = await createSimulatedClient(browser, baseURL!, 'fresh', testRunId);
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

      const setupStart = Date.now();
      await fresh.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });
      const t0 = await enterJoinerPassword(fresh.page, password);
      const freshPage = fresh.page;
      await expect
        .poll(() => getCursor(freshPage), { timeout: 35 * 60 * 1000, intervals: [2000] })
        .toBeGreaterThanOrEqual(latestSeq);
      const wallMs = Date.now() - t0;
      await waitForTask(freshPage, taskName);
      await expect(fresh.sync.syncErrorIcon).not.toBeVisible();

      const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
      const pages = (await Promise.all(pagePromises)).filter(
        (record): record is PageRecord => record !== null,
      );
      const afterPassword = pages.filter((record) => record.startedAt >= t0);
      const firstPage = afterPassword.find((record) => record.sinceSeq === 0);
      const download = buildPageStats(afterPassword);
      const passes = phases.filter(
        ({ t, text }) => t >= t0 && text.includes('Starting download'),
      ).length;

      const report = {
        tailOps: TAIL_OPS,
        importSeq,
        latestSeq,
        templateTypes: templates.map((op) => `${op.entityType}:${op.actionType}`),
        seedMs,
        setupToPasswordMs: t0 - setupStart,
        beforePassword: buildPageStats(pages.filter((record) => record.startedAt < t0)),
        wallMs,
        passes,
        download,
        clientMs: wallMs - download.requestTotalMs,
        firstPage,
        violations: summarizeViolations(violations),
        phases: phases
          .filter(({ t }) => t >= t0)
          .map(({ t, text }) => `+${((t - t0) / 1000).toFixed(1)}s ${text}`),
        cpu: summarizeProfile(profile),
      };
      console.log(`${LOG_PREFIX} ${JSON.stringify(report, null, 2)}`);
      await test.info().attach('long-history-report.json', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      // Today's behavior: the server starts at the newest import and streams
      // every op after it; no snapshot replaces the tail. A fix that serves a
      // snapshot or a compacted tail should flip these assertions.
      expect(firstPage?.firstOpType).toBe('SYNC_IMPORT');
      expect(download.ops).toBeGreaterThanOrEqual(latestSeq - importSeq + 1);
      if (TAIL_OPS > DOWNLOAD_CAP) expect(passes).toBeGreaterThanOrEqual(2);
    } finally {
      if (seeder) await closeClient(seeder);
      if (fresh) await closeClient(fresh);
    }
  });
});
