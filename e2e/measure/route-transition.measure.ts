/**
 * Manual measurement harness for route (page) transitions on a phone viewport.
 *
 * Not a performance assertion: it prints numbers and always passes. Run it by hand:
 *
 *   npx playwright test --config e2e/measure/playwright.measure.config.ts \
 *     --project=measure-chromium route-transition
 *
 * For each route change it prints:
 * - `settle` — navigation to the end of the last animation it started: how long
 *   the page is in motion.
 * - `anims`  — the animations that ran, as `target:delay+duration`. A child
 *   starting after the page's own motion has ended is a second, chained motion.
 * - `max gap` / `>34ms` — the longest frame gap and the number of frames slower
 *   than two vsyncs during that window (CPU throttled by MEASURE_CPU_THROTTLE).
 *
 * MEASURE_OPEN_TASK_COUNT sizes the seeded Inbox list. `ng serve` compiles
 * templates at runtime, which inflates every first render; for render cost,
 * serve `ng build --configuration development --optimization --aot` statically
 * and point E2E_BASE_URL at it (the seed needs a non-production build). This
 * machine is not a phone: read before/after ratios, not absolute milliseconds.
 */
import { test } from '../fixtures/test.fixture';
import type { Page } from '@playwright/test';

const readCount = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
};

const OPEN_TASK_COUNT = readCount('MEASURE_OPEN_TASK_COUNT', 60);
const CPU_THROTTLE = readCount('MEASURE_CPU_THROTTLE', 4);
const ROUNDS = readCount('MEASURE_ROUNDS', 2);

const ROUTES = [
  '#/tag/TODAY/tasks',
  '#/project/INBOX_PROJECT/tasks',
  '#/planner',
  '#/schedule',
  '#/habits',
  '#/tag/TODAY/tasks',
  '#/config',
  '#/project/INBOX_PROJECT/tasks',
  '#/project/measure-p-0/tasks',
  '#/project/INBOX_PROJECT/tasks',
];

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (fn: (state: Record<string, unknown>) => void) => { unsubscribe(): void };
};

const seed = async (page: Page): Promise<void> => {
  await page.evaluate((count) => {
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing — is this a non-production build?');
    }
    let state: Record<string, unknown> = {};
    store.subscribe((s) => (state = s)).unsubscribe();
    const inbox = (state['projects'] as { entities: Record<string, object> }).entities[
      'INBOX_PROJECT'
    ];
    // A second project, cloned from the Inbox so the seed never drifts from the model.
    store.dispatch({
      type: '[Project] Add Project',
      project: {
        ...inbox,
        id: 'measure-p-0',
        title: 'Measure project',
        taskIds: [],
        backlogTaskIds: [],
        icon: null,
      },
      meta: {
        isPersistent: true,
        entityType: 'PROJECT',
        entityId: 'measure-p-0',
        opType: 'CRT',
      },
    });
    const operations = Array.from({ length: count }, (_, index) => ({
      type: 'create',
      tempId: `temp-${index}`,
      data: { title: `Measure seed ${index + 1}`, isDone: false },
    }));
    store.dispatch({
      type: '[Task Shared] batchUpdateForProject',
      projectId: 'INBOX_PROJECT',
      operations,
      createdTaskIds: Object.fromEntries(
        operations.map(({ tempId }, index) => [tempId, `measure-task-${index}`]),
      ),
      createdTaskTimestamp: 1_750_000_000_000,
      meta: {
        isPersistent: true,
        entityType: 'PROJECT',
        entityId: 'INBOX_PROJECT',
        opType: 'BATCH',
      },
    });
  }, OPEN_TASK_COUNT);
};

type Result = {
  settle: number;
  maxGap: number;
  slowFrames: number;
  anims: string[];
};

/** Navigates by hash and records animations and frame gaps until motion stops. */
const measureNavigation = (page: Page, hash: string): Promise<Result> =>
  page.evaluate(
    (target) =>
      new Promise<Result>((resolve) => {
        const seen = new Map<Animation, string>();
        const frames: number[] = [];
        const describe = (a: Animation): string => {
          const effect = a.effect as KeyframeEffect | null;
          const el = effect?.target as Element | null;
          const tag = el
            ? `${el.tagName.toLowerCase()}${el.classList[0] ? `.${el.classList[0]}` : ''}`
            : '?';
          const timing = effect?.getComputedTiming();
          return `${tag}:${Math.round(Number(timing?.delay ?? 0))}+${Math.round(
            Number(timing?.duration ?? 0),
          )}`;
        };
        const ends = new Map<Animation, number>();
        const start = performance.now();
        location.hash = target;
        let lastActive = start;
        const tick = (now: number): void => {
          frames.push(now);
          const running = document.getAnimations().filter((a) => {
            const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
            return !!t?.closest('.route-wrapper');
          });
          for (const a of running) {
            if (!seen.has(a)) {
              seen.set(a, `${Math.round(now - start)}ms ${describe(a)}`);
            }
            if (a.playState === 'running') {
              ends.set(a, now);
            }
          }
          if (running.some((a) => a.playState === 'running')) {
            lastActive = now;
          }
          // 300ms with nothing running ends the window.
          if (now - lastActive > 300 && now - start > 300) {
            const window = frames.filter((f) => f <= lastActive + 17);
            const gaps = window.slice(1).map((f, i) => f - window[i]);
            const firstGap = (window[0] ?? start) - start;
            resolve({
              settle: Math.round(lastActive - start),
              maxGap: Math.round(Math.max(firstGap, ...gaps)),
              slowFrames: gaps.filter((g) => g > 34).length,
              anims: [...seen.values()].slice(0, 12),
            });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    hash,
  );

test('route transitions on a phone viewport', async ({ page }) => {
  await seed(page);
  const cdp = await page.context().newCDPSession(page);
  await page.waitForTimeout(500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  const rows: string[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    for (let i = 1; i < ROUTES.length; i++) {
      const r = await measureNavigation(page, ROUTES[i]);
      await page.waitForTimeout(300);
      if (round === 0) continue; // warm-up: lazy chunks, first renders
      rows.push(
        `${ROUTES[i - 1].padEnd(30)} -> ${ROUTES[i].padEnd(30)} settle ${String(
          r.settle,
        ).padStart(4)}ms  max gap ${String(r.maxGap).padStart(4)}ms  >34ms ${String(
          r.slowFrames,
        ).padStart(2)}  anims ${r.anims.join(', ')}`,
      );
    }
    await measureNavigation(page, ROUTES[0]);
    await page.waitForTimeout(300);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(
    `\nCPU throttle ${CPU_THROTTLE}x, ${OPEN_TASK_COUNT} tasks\n${rows.join('\n')}`,
  );
});
