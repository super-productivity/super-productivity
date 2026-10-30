/**
 * Manual measurement harness for #10820 — "the menu button and the options in
 * the menu respond too slowly" on Android.
 *
 * Not a performance assertion: it prints numbers and always passes. Run it by hand:
 *
 *   npx playwright test --config e2e/measure/playwright.measure.config.ts \
 *     --project=measure-chromium mobile-side-nav-open
 *
 * Chromium only for the numbers that matter: the Android WebView is Blink, and
 * CPU throttling (MEASURE_CPU_THROTTLE, default 4) needs CDP.
 *
 * For each open/close cycle it prints, per tap on the bottom-nav menu button:
 * - `handler`  — synchronous time of the click (event handler + the change
 *   detection zone.js runs after it). Nothing paints before this ends.
 * - `frame`    — tap to the first frame after it (double rAF).
 * - CDP `Performance.getMetrics` deltas (script/style/layout) for the whole
 *   open, including the enter animation.
 *
 * MEASURE_OPEN_TASK_COUNT / MEASURE_DONE_TASK_COUNT / MEASURE_PROJECT_COUNT / MEASURE_TAG_COUNT size the
 * seeded data. `ng serve` is unoptimized and this machine is not a phone: read
 * before/after ratios, not absolute milliseconds.
 */
import { test } from '../fixtures/test.fixture';
import type { CDPSession, Page } from '@playwright/test';

const readCount = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
};

const OPEN_TASK_COUNT = readCount('MEASURE_OPEN_TASK_COUNT', 100);
const DONE_TASK_COUNT = readCount('MEASURE_DONE_TASK_COUNT', 100);
const PROJECT_COUNT = readCount('MEASURE_PROJECT_COUNT', 10);
const TAG_COUNT = readCount('MEASURE_TAG_COUNT', 10);
const CPU_THROTTLE = readCount('MEASURE_CPU_THROTTLE', 4);
const CYCLES = readCount('MEASURE_CYCLES', 8);
const INBOX_PROJECT_ID = 'INBOX_PROJECT';
const MENU_BTN = 'mobile-bottom-nav .tour-navMenuBtn';

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (fn: (state: Record<string, unknown>) => void) => { unsubscribe(): void };
};

const seed = async (page: Page): Promise<void> => {
  await page.evaluate(
    ({ projectCount, tagCount, taskCount, doneCount, inboxId }) => {
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('__e2eTestHelpers.store missing — is this a dev/stage build?');
      }
      let state: Record<string, unknown> = {};
      store.subscribe((s) => (state = s)).unsubscribe();
      const entitiesOf = (key: string): Record<string, Record<string, unknown>> =>
        (state[key] as { entities: Record<string, Record<string, unknown>> }).entities;
      // Clone existing entities as templates so the seed never drifts from the model.
      const inbox = entitiesOf('projects')[inboxId];
      // A fresh profile may hold only the virtual TODAY tag; its shape is a plain Tag.
      const tagTemplate = entitiesOf('tag')['TODAY'];
      if (!inbox || !tagTemplate) {
        throw new Error('no project/tag template in state');
      }
      const meta = (entityType: string, entityId: string): Record<string, unknown> => ({
        isPersistent: true,
        entityType,
        entityId,
        opType: 'CRT',
      });
      for (let i = 0; i < projectCount; i++) {
        const project = { ...inbox, id: `measure-p-${i}`, title: `Measure project ${i}` };
        store.dispatch({
          type: '[Project] Add Project',
          project: { ...project, taskIds: [], backlogTaskIds: [], icon: null },
          meta: meta('PROJECT', project.id),
        });
      }
      for (let i = 0; i < tagCount; i++) {
        const tag = { ...tagTemplate, id: `measure-t-${i}`, title: `Measure tag ${i}` };
        store.dispatch({
          type: '[Tag] Add Tag',
          tag: { ...tag, taskIds: [], icon: null },
          meta: meta('TAG', tag.id),
        });
      }
      const operations = Array.from({ length: taskCount + doneCount }, (_, index) => ({
        type: 'create',
        tempId: `temp-${index}`,
        data: { title: `Measure seed ${index + 1}`, isDone: index >= taskCount },
      }));
      const createdTaskIds = Object.fromEntries(
        operations.map(({ tempId }, index) => [tempId, `measure-task-${index}`]),
      );
      for (let offset = 0; offset < operations.length; offset += 50) {
        store.dispatch({
          type: '[Task Shared] batchUpdateForProject',
          projectId: inboxId,
          operations: operations.slice(offset, offset + 50),
          createdTaskIds,
          createdTaskTimestamp: 1_750_000_000_000,
          meta: { ...meta('PROJECT', inboxId), opType: 'BATCH' },
        });
      }
    },
    {
      projectCount: PROJECT_COUNT,
      tagCount: TAG_COUNT,
      taskCount: OPEN_TASK_COUNT,
      doneCount: DONE_TASK_COUNT,
      inboxId: INBOX_PROJECT_ID,
    },
  );
};

/** Clicks `selector` in-page and times the sync handler and the next frame. */
const timedClick = (
  page: Page,
  selector: string,
  text?: string,
): Promise<[number, number]> =>
  page.evaluate(
    ({ sel, txt }) =>
      new Promise<[number, number]>((resolve) => {
        const el = [...document.querySelectorAll<HTMLElement>(sel)].find(
          (e) => !txt || e.textContent?.includes(txt),
        );
        if (!el) {
          throw new Error(`${sel} missing`);
        }
        const start = performance.now();
        el.click();
        const handler = performance.now() - start;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve([handler, performance.now() - start])),
        );
      }),
    { sel: selector, txt: text },
  );

const METRICS = ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'] as const;

const readMetrics = async (cdp: CDPSession): Promise<Record<string, number>> => {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
};

type ProfileNode = {
  id: number;
  children?: number[];
  callFrame: { functionName: string; url: string; lineNumber: number };
};

const toMs = (micros: number): number => micros / 1000;

/** One profiled open; top functions by self time. MEASURE_PROFILE=1 enables it. */
const profileOpen = async (page: Page, cdp: CDPSession): Promise<string[]> => {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await timedClick(page, MENU_BTN);
  await page.locator('.nav-sidenav').waitFor();
  await page.waitForTimeout(400);
  const { profile } = (await cdp.send('Profiler.stop')) as {
    profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] };
  };
  await timedClick(page, '.nav-backdrop-mobile');
  await page.locator('.nav-backdrop-mobile').waitFor({ state: 'detached' });
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const { functionName, url, lineNumber } = byId.get(id)!.callFrame;
    const key = `${functionName || '(anon)'} ${url.split('/').pop()}:${lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + toMs(profile.timeDeltas[i]));
  });
  // Inclusive time per function name, counting each name once per stack, so
  // component templates and factories show up with what they cost in total.
  const selfById = new Map<number, number>();
  profile.samples.forEach((id, i) =>
    selfById.set(id, (selfById.get(id) ?? 0) + toMs(profile.timeDeltas[i])),
  );
  const inclusive = new Map<string, number>();
  const walk = (id: number, onStack: Set<string>): number => {
    const node = byId.get(id)!;
    const name = node.callFrame.functionName || '(anon)';
    const fresh = !onStack.has(name);
    if (fresh) onStack.add(name);
    let total = selfById.get(id) ?? 0;
    for (const child of node.children ?? []) total += walk(child, onStack);
    if (fresh) {
      onStack.delete(name);
      inclusive.set(name, (inclusive.get(name) ?? 0) + total);
    }
    return total;
  };
  walk(profile.nodes[0].id, new Set());
  const top = (m: Map<string, number>, label: string): string[] =>
    [...m.entries()]
      .filter(([key]) => !/^\((idle|program|root|anon)\)/.test(key))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 150)
      .map(([key, ms]) => `profile ${label} ${ms.toFixed(1).padStart(7)}ms  ${key}`);
  return [...top(self, 'self'), ...top(inclusive, 'incl')];
};

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const fmt = (label: string, values: number[]): string =>
  `${label.padEnd(26)} median=${median(values).toFixed(1)}ms ` +
  `min=${Math.min(...values).toFixed(1)} max=${Math.max(...values).toFixed(1)}`;

test.describe('#10820 mobile side nav open cost', () => {
  test('menu open/close and nav item tap', async ({
    page,
    workViewPage,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'needs CDP for throttling and metrics');
    const record = (line: string): void => console.log(`[measure] ${line}`);

    await page.evaluate((id) => {
      window.location.hash = `#/project/${id}/tasks`;
    }, INBOX_PROJECT_ID);
    await workViewPage.waitForTaskList();
    await seed(page);
    await page
      .locator('task')
      .nth(OPEN_TASK_COUNT - 1)
      .waitFor({ timeout: 30000 });
    // Let boot work drain; there is no event that signals "idle".
    await page.waitForTimeout(2000);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    record(
      `tasks=${OPEN_TASK_COUNT}+${DONE_TASK_COUNT}done projects=${PROJECT_COUNT} tags=${TAG_COUNT} ` +
        `cpu=${CPU_THROTTLE}x cycles=${CYCLES}`,
    );

    const open = { handler: [] as number[], frame: [] as number[] };
    const close = { handler: [] as number[], frame: [] as number[] };
    const totals: Record<string, number[]> = {};
    for (let i = 0; i < CYCLES; i++) {
      const before = await readMetrics(cdp);
      const [h, f] = await timedClick(page, MENU_BTN);
      await page.locator('.nav-sidenav').waitFor();
      // Include the 225ms enter animation in the CDP window.
      await page.waitForTimeout(400);
      const after = await readMetrics(cdp);
      open.handler.push(h);
      open.frame.push(f);
      for (const m of METRICS) {
        (totals[m] ??= []).push((after[m] - before[m]) * 1000);
      }
      const [ch, cf] = await timedClick(page, '.nav-backdrop-mobile');
      close.handler.push(ch);
      close.frame.push(cf);
      await page.locator('.nav-backdrop-mobile').waitFor({ state: 'detached' });
      await page.waitForTimeout(400);
    }
    record(fmt('open: tap handler', open.handler));
    record(fmt('open: tap -> frame', open.frame));
    for (const m of METRICS) {
      record(fmt(`open: ${m} (window)`, totals[m]));
    }
    record(fmt('close: tap handler', close.handler));
    record(fmt('close: tap -> frame', close.frame));

    // "Options": tap a project in the open menu and time until the route paints.
    const nav = { handler: [] as number[], frame: [] as number[] };
    for (let i = 0; i < CYCLES; i++) {
      await timedClick(page, MENU_BTN);
      await page.locator('.nav-sidenav').waitFor();
      await page.waitForTimeout(400);
      const target = i % 2 === 0 ? 'Measure project 0' : 'Inbox';
      const [h, f] = await timedClick(
        page,
        '.nav-sidenav a, .nav-sidenav button',
        target,
      );
      nav.handler.push(h);
      nav.frame.push(f);
      await page.locator('.nav-backdrop-mobile').waitFor({ state: 'detached' });
      await page.waitForTimeout(600);
    }
    record(fmt('item: tap handler', nav.handler));
    record(fmt('item: tap -> frame', nav.frame));
    if (process.env.MEASURE_PROFILE) {
      for (const line of await profileOpen(page, cdp)) {
        record(line);
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});
