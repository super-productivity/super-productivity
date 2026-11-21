/**
 * Scaling benchmark: how much slower do common interactions get as the account
 * grows? See `e2e/README.md` § Performance benchmark for usage and limits.
 *
 * Each profile is imported once through the production backup UI, validated,
 * and saved with `storageState({ indexedDB: true })`. Every sample then starts a
 * fresh browser context from that saved state, so all samples begin from an
 * identical account without re-importing.
 */
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import {
  DATASET_VERSION,
  FOCUS_PROJECT_ID,
  generateAccount,
  PROFILES,
  SOURCE_PROJECT_ID,
  type BenchmarkAccount,
  type Profile,
} from './dataset';
import {
  armInteraction,
  collectTiming,
  installPerfInit,
  reloadAndArm,
  type ReadySpec,
  type Timing,
} from './measure';
import { renderMarkdown, type RunResult } from './report';

const REPO_ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, '.tmp', 'perf');
const DIST_INDEX = path.join(REPO_ROOT, 'dist', 'browser', 'index.html');
/** Bump when scenario definitions or timing semantics change. */
const HARNESS_VERSION = 1;

const list = (value: string | undefined): string[] | null =>
  value ? value.split(',').map((s) => s.trim()) : null;
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 5);
const INJECT_DELAY_MS = Number(process.env.PERF_INJECT_DELAY_MS ?? 0);
const PROFILE_FILTER = list(process.env.PERF_PROFILES);
const SCENARIO_FILTER = list(process.env.PERF_SCENARIOS);

const CONTEXT_OPTIONS: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'Europe/Berlin',
  colorScheme: 'light',
  reducedMotion: 'no-preference',
  // An installed PWA would serve from the service worker; blocking it keeps the
  // cache policy identical between samples (fresh context, warm HTTP cache on reload).
  serviceWorkers: 'block',
};

interface Prepared {
  profile: Profile;
  account: BenchmarkAccount;
  statePath: string;
}

const projectUrl = (id: string): string => `/#/project/${id}/tasks`;
const taskSel = (id: string): string => `#t-${id}`;
/** First rows of the focus list: the "expected first viewport". */
const focusRows = (account: BenchmarkAccount): string[] =>
  [account.focusTaskIds[0], account.focusTaskIds[9]].map(taskSel);

const skipOnboarding = (): void => {
  localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
  localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
  localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
  localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
};

/** A page whose uncaught errors and data repairs fail the run. */
const openPage = async (
  browser: Browser,
  storageState?: string,
): Promise<{ page: Page; close: () => Promise<void> }> => {
  const context = await browser.newContext({ ...CONTEXT_OPTIONS, storageState });
  await context.addInitScript(skipOnboarding);
  const page = await context.newPage();
  await installPerfInit(page, INJECT_DELAY_MS);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.text().includes('attempting repair')) problems.push('data repair ran');
  });
  return {
    page,
    close: async () => {
      await context.close();
      if (problems.length) throw new Error(problems.join('; '));
    },
  };
};

const expectAccountShown = async (
  page: Page,
  account: BenchmarkAccount,
): Promise<void> => {
  await page.goto(projectUrl(FOCUS_PROJECT_ID));
  for (const sel of focusRows(account)) await expect(page.locator(sel)).toBeAttached();
  const { ids, entities } = account.data.project;
  for (const id of ids) {
    const { title, taskIds } = entities[id];
    const item =
      id === 'INBOX_PROJECT'
        ? page
            .getByRole('listitem')
            .filter({ has: page.getByRole('menuitem', { name: 'Inbox', exact: true }) })
        : page.getByRole('treeitem', { name: title, exact: false });
    await expect(item.first(), `${title} task count`).toContainText(
      String(taskIds.length),
    );
  }
};

const importProfile = async (browser: Browser, profile: Profile): Promise<Prepared> => {
  const account = generateAccount(profile);
  mkdirSync(OUT_DIR, { recursive: true });
  const dataPath = path.join(OUT_DIR, `${profile.name}.json`);
  const statePath = path.join(OUT_DIR, `${profile.name}.state.json`);
  writeFileSync(dataPath, JSON.stringify(account.data));

  const { page, close } = await openPage(browser);
  await page.goto('/');
  await page.waitForURL(/tag\/TODAY/);
  await page.goto('/#/config');
  await page.getByRole('tab', { name: 'Sync & Backup' }).click();
  await page.locator('collapsible:has-text("Import/Export") .collapsible-header').click();
  await page.locator('file-imex input[type=file]').first().setInputFiles(dataPath);
  // The import component navigates to Today only after the import is persisted.
  await page.waitForURL(/tag\/TODAY/);
  await expectAccountShown(page, account);
  await page.reload();
  await expectAccountShown(page, account);
  await page.context().storageState({ path: statePath, indexedDB: true });
  await close();
  return { profile, account, statePath };
};

interface Scenario {
  name: string;
  run: (page: Page, prepared: Prepared, sampleId: string) => Promise<Timing>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'reload',
    run: async (page, { account }) => {
      await page.goto(projectUrl(FOCUS_PROJECT_ID));
      await expect(page.locator(focusRows(account)[0])).toBeVisible();
      const spec: ReadySpec = {
        present: focusRows(account),
        absent: ['.loading-full-page-wrapper'],
      };
      await reloadAndArm(page, spec);
      return collectTiming(page);
    },
  },
  {
    name: 'switch-project',
    run: async (page, { account }) => {
      await page.goto(projectUrl(SOURCE_PROJECT_ID));
      await expect(page.locator(taskSel(account.sourceTaskIds[0]))).toBeVisible();
      const target = page.getByRole('menuitem', { name: 'Benchmark focus', exact: true });
      await target.scrollIntoViewIfNeeded();
      await armInteraction(
        page,
        { present: focusRows(account), absent: [taskSel(account.sourceTaskIds[0])] },
        'click',
      );
      await target.click();
      const timing = await collectTiming(page);
      await expect(page).toHaveURL(new RegExp(`project/${FOCUS_PROJECT_ID}/`));
      return timing;
    },
  },
  {
    name: 'add-task',
    run: async (page, { account }, sampleId) => {
      await page.goto(projectUrl(FOCUS_PROJECT_ID));
      await expect(page.locator(focusRows(account)[0])).toBeVisible();
      await page.locator('.tour-addBtn').click();
      const input = page.locator('add-task-bar.global .main-input');
      const title = `Perf added ${sampleId}`;
      await input.fill(title);
      await armInteraction(
        page,
        { present: [], absent: [], taskTitle: title },
        'keydown',
      );
      await input.press('Enter');
      const timing = await collectTiming(page);
      await expect(page.locator('task-list task', { hasText: title })).toHaveCount(1);
      return timing;
    },
  },
];

const buildMeta = (
  profiles: Profile[],
  scenarios: Scenario[],
  browserVersion: string,
): RunResult['meta'] => {
  const git = (cmd: string): string =>
    execSync(`git ${cmd}`, { cwd: REPO_ROOT }).toString().trim();
  return {
    commit: git('rev-parse HEAD'),
    isDirty: git('status --porcelain --untracked-files=no') !== '',
    buildIndexSha256: createHash('sha256').update(readFileSync(DIST_INDEX)).digest('hex'),
    harnessVersion: HARNESS_VERSION,
    datasetVersion: DATASET_VERSION,
    browser: `chromium ${browserVersion}`,
    os: `${os.platform()} ${os.release()}`,
    cpu: `${os.cpus()[0]?.model} x${os.cpus().length}`,
    runner: process.env.RUNNER_NAME ?? 'local',
    samplesPerCell: SAMPLES,
    warmupsPerCell: 1,
    injectDelayMs: INJECT_DELAY_MS,
    profiles,
    scenarios: scenarios.map((s) => s.name),
    context: CONTEXT_OPTIONS,
    cachePolicy:
      'fresh context per sample; service workers blocked; reload uses warm HTTP cache',
  };
};

const writeResult = (result: RunResult): void => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(result, null, 2));
  const md = renderMarkdown(result);
  writeFileSync(path.join(OUT_DIR, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(`\n${md}`);
};

test('performance benchmark', async ({ browser, request }) => {
  const profiles = PROFILES.filter(
    (p) => !PROFILE_FILTER || PROFILE_FILTER.includes(p.name),
  );
  const scenarios = SCENARIOS.filter(
    (s) => !SCENARIO_FILTER || SCENARIO_FILTER.includes(s.name),
  );
  expect(profiles.length, 'PERF_PROFILES matches no profile').toBeGreaterThan(0);
  expect(scenarios.length, 'PERF_SCENARIOS matches no scenario').toBeGreaterThan(0);

  const result: RunResult = {
    status: 'invalid',
    meta: buildMeta(profiles, scenarios, browser.version()),
    samples: [],
  };
  try {
    const served = await (await request.get('/index.html')).body();
    expect(
      createHash('sha256').update(served).digest('hex'),
      'served build is not dist/browser',
    ).toBe(result.meta.buildIndexSha256);

    const prepared: Prepared[] = [];
    for (const profile of profiles) {
      await test.step(`import ${profile.name}`, async () => {
        prepared.push(await importProfile(browser, profile));
      });
    }

    let order = 0;
    for (const scenario of scenarios) {
      // rep 0 is the discarded warm-up; rotating the profile order per rep keeps
      // drift on a shared runner from landing on one profile.
      for (let rep = 0; rep <= SAMPLES; rep++) {
        for (let i = 0; i < prepared.length; i++) {
          const p = prepared[(i + rep) % prepared.length];
          const sampleId = `${scenario.name}-${p.profile.name}-${order}`;
          await test.step(sampleId, async () => {
            const { page, close } = await openPage(browser, p.statePath);
            const t = await scenario.run(page, p, sampleId);
            await close();
            result.samples.push({
              scenario: scenario.name,
              profile: p.profile.name,
              order: order++,
              isWarmup: rep === 0,
              ms: t.frame - t.start,
              readyMs: t.ready - t.start,
            });
          });
        }
      }
    }
    result.status = 'valid';
  } catch (e) {
    // Strip Playwright's ANSI colors so the summary stays readable.
    const msg = (e instanceof Error ? e.message : String(e)).replace(
      /\u001b\[[0-9;]*m/g,
      '',
    );
    result.error = msg.split('\n')[0];
    throw e;
  } finally {
    writeResult(result);
  }
});
