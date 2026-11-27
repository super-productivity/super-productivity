/**
 * Manual measurement harness for the CPU cost of time tracking on a large dataset.
 *
 * Not a performance assertion: it prints numbers and always passes. Run it by hand
 * against a static non-production build (the seed needs `__e2eTestHelpers`; `ng serve`
 * inflates render cost):
 *
 *   npx ng build --configuration development --optimization --aot --output-path <dir>
 *   npx http-server <dir>/browser -p 4300 -s &
 *   E2E_BASE_URL=http://localhost:4300 npx playwright test \
 *     --config e2e/measure/playwright.measure.config.ts \
 *     --project=measure-chromium-desktop tracking-tick
 *
 * It seeds ~MEASURE_TASK_COUNT tasks (projects, tags, done, due, subtasks, planner
 * days), starts tracking one task, then for each view waits MEASURE_SETTLE_MS and
 * records MEASURE_WINDOW_MS of CPU: `Performance.getMetrics` ScriptDuration and
 * TaskDuration per second, store dispatches per second by action type, and the top
 * self-time functions of a `Profiler` sample. Repeats MEASURE_ROUNDS times, prints
 * medians. MEASURE_CPU_THROTTLE defaults to 1 (none).
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

const TASK_COUNT = readCount('MEASURE_TASK_COUNT', 2000);
const CPU_THROTTLE = readCount('MEASURE_CPU_THROTTLE', 1);
const ROUNDS = readCount('MEASURE_ROUNDS', 3);
const SETTLE_MS = readCount('MEASURE_SETTLE_MS', 3000);
const WINDOW_MS = readCount('MEASURE_WINDOW_MS', 10000);

const VIEWS = [
  '#/tag/TODAY/tasks',
  '#/planner',
  '#/schedule',
  '#/project/measure-p-0/tasks',
];

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (fn: (state: Record<string, unknown>) => void) => { unsubscribe(): void };
};
type TestWindow = {
  __e2eTestHelpers?: { store?: StoreLike };
  __dispatchCounts?: Record<string, number>;
};

const seed = async (page: Page, count: number): Promise<string> =>
  page.evaluate((total) => {
    const store = (window as unknown as TestWindow).__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing — non-production build?');
    const getState = (): Record<string, any> => {
      let s: Record<string, any> = {};
      store.subscribe((x) => (s = x)).unsubscribe();
      return s;
    };
    const day = (offset: number): string => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const p = (n: number): string => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const DAY_MS = 86_400_000;
    const now = Date.now();
    const state = getState();
    const inbox = state['projects'].entities['INBOX_PROJECT'];
    const projectIds = ['INBOX_PROJECT', 'measure-p-0', 'measure-p-1', 'measure-p-2'];
    for (const id of projectIds.slice(1)) {
      store.dispatch({
        type: '[Project] Add Project',
        project: { ...inbox, id, title: id, taskIds: [], backlogTaskIds: [], icon: null },
        meta: { isPersistent: true, entityType: 'PROJECT', entityId: id, opType: 'CRT' },
      });
    }
    const tagIds = ['measure-t-0', 'measure-t-1', 'measure-t-2', 'measure-t-3'];
    const todayTag = state['tag'].entities['TODAY'];
    for (const id of tagIds) {
      store.dispatch({
        type: '[Tag] Add Tag',
        tag: { ...todayTag, id, title: id, taskIds: [], icon: null },
        meta: { isPersistent: true, entityType: 'TAG', entityId: id, opType: 'CRT' },
      });
    }

    // ~4% of root tasks get two subtasks; roots + subtasks sum to `total`.
    const rootCount = Math.round(total / 1.08);
    const subEvery = 25;
    const rootIds: string[] = [];
    const byProject = new Map<string, any[]>();
    let seq = 0;
    let made = 0;
    for (let i = 0; i < rootCount; i++) {
      const pid = projectIds[i % projectIds.length];
      const ops = byProject.get(pid) ?? [];
      byProject.set(pid, ops);
      const tempId = `temp-${i}`;
      ops.push({
        type: 'create',
        tempId,
        data: { title: `Task ${i}`, isDone: false, timeEstimate: 1_800_000 },
      });
      rootIds.push(`measure-task-${i}`);
      made++;
      if (i % subEvery === 0) {
        for (let s = 0; s < 2; s++) {
          ops.push({
            type: 'create',
            tempId: `temp-sub-${i}-${s}`,
            data: { title: `Sub ${i}.${s}`, parentId: tempId },
          });
          made++;
        }
      }
    }
    const monthMs = DAY_MS * 30;
    const monthAgo = now - monthMs;
    for (const [pid, ops] of byProject) {
      const createdTaskIds: Record<string, string> = {};
      for (const op of ops) {
        createdTaskIds[op.tempId] = op.tempId.startsWith('temp-sub-')
          ? `measure-sub-${seq++}`
          : `measure-task-${op.tempId.slice(5)}`;
      }
      store.dispatch({
        type: '[Task Shared] batchUpdateForProject',
        projectId: pid,
        operations: ops,
        createdTaskIds,
        createdTaskTimestamp: monthAgo,
        meta: {
          isPersistent: true,
          entityType: 'PROJECT',
          entityId: pid,
          opType: 'BATCH',
        },
      });
    }

    // Bulk patch fields the batch API cannot set. No `meta`: keeps op-log out of it.
    const updates: { id: string; changes: Record<string, unknown> }[] = [];
    const dueByDay = new Map<string, string[]>();
    rootIds.forEach((id, i) => {
      const changes: Record<string, unknown> = {};
      const bucket = i % 10;
      if (bucket < 3) {
        changes['isDone'] = true;
        const daysAgoMs = DAY_MS * (i % 2);
        const minutesAgoMs = 60_000 * (i % 50);
        changes['doneOn'] = now - daysAgoMs - minutesAgoMs;
      } else if (bucket === 3) {
        // next 2 weeks, hour-aligned; i<200 lands today so Today has content
        const offset = i < 200 ? 0 : 1 + (i % 14);
        const offsetMs = DAY_MS * offset;
        const hourMs = 3_600_000 * (i % 10);
        changes['dueWithTime'] = now + offsetMs + hourMs;
      } else if (bucket === 4) {
        const dd = day(i < 200 ? 0 : 1 + (i % 14));
        changes['dueDay'] = dd;
        dueByDay.set(dd, [...(dueByDay.get(dd) ?? []), id]);
      }
      if (i % 3 === 0) changes['tagIds'] = [tagIds[i % tagIds.length]];
      if (Object.keys(changes).length) updates.push({ id, changes });
    });
    store.dispatch({
      type: '[Task] Update multiple Tasks (simple)',
      taskUpdates: updates,
    });

    for (const [dd, ids] of dueByDay) {
      if (dd === day(0)) continue;
      store.dispatch({
        type: '[Planner] Upsert Planner Day',
        day: dd,
        taskIds: ids,
        meta: { isPersistent: true, entityType: 'PLANNER', entityId: dd, opType: 'UPD' },
      });
    }

    // Track a plain open task in the project view.
    const target = rootIds.find((_, i) => i % 10 >= 5 && i % projectIds.length === 1);
    store.dispatch({ type: '[Task] SetCurrentTask', id: target });

    // Count every dispatch (effects share this Store instance).
    const w = window as unknown as TestWindow;
    w.__dispatchCounts = {};
    const orig = store.dispatch.bind(store);
    store.dispatch = (action: unknown): void => {
      const type = (action as { type?: string })?.type ?? '?';
      w.__dispatchCounts![type] = (w.__dispatchCounts![type] ?? 0) + 1;
      orig(action);
    };
    return `${made} tasks created (${rootIds.length} roots), tracking ${target}`;
  }, count);

type CpuNode = {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
};
type CpuProfile = { nodes: CpuNode[]; samples: number[]; timeDeltas: number[] };

/** Self time per functionName@url:line in ms, plus idle/program/gc buckets. */
const selfTimes = (profile: CpuProfile): Map<string, number> => {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const totals = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const cf = byId.get(id)!.callFrame;
    const file = cf.url.split('/').pop() || '';
    const key = cf.url
      ? `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`
      : cf.functionName;
    const sampleMs = (profile.timeDeltas[i] ?? 0) / 1000;
    totals.set(key, (totals.get(key) ?? 0) + sampleMs);
  });
  return totals;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

type Sample = {
  script: number;
  task: number;
  dispatches: Record<string, number>;
  self: Map<string, number>;
};

test('time-tracking CPU per second on a large dataset', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  console.log(await seed(page, TASK_COUNT));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  await page.waitForTimeout(2000);

  const metric = async (name: string): Promise<number> => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((m: { name: string }) => m.name === name)?.value ?? 0;
  };
  const results = new Map<string, Sample[]>();
  for (let round = 0; round < ROUNDS; round++) {
    for (const view of VIEWS) {
      await page.evaluate((h) => (location.hash = h), view);
      await page.waitForTimeout(SETTLE_MS);
      await page.evaluate(
        () => ((window as unknown as TestWindow).__dispatchCounts = {}),
      );
      await cdp.send('Profiler.start');
      const [s0, t0] = [await metric('ScriptDuration'), await metric('TaskDuration')];
      await page.waitForTimeout(WINDOW_MS);
      const [s1, t1] = [await metric('ScriptDuration'), await metric('TaskDuration')];
      const { profile } = await cdp.send('Profiler.stop');
      const counts = await page.evaluate(
        () => (window as unknown as TestWindow).__dispatchCounts ?? {},
      );
      const sec = WINDOW_MS / 1000;
      const sample: Sample = {
        script: ((s1 - s0) * 1000) / sec,
        task: ((t1 - t0) * 1000) / sec,
        dispatches: Object.fromEntries(
          Object.entries(counts).map(([k, v]) => [k, (v as number) / sec]),
        ),
        self: new Map(
          [...selfTimes(profile as CpuProfile)].map(([k, v]) => [k, v / sec]),
        ),
      };
      results.set(view, [...(results.get(view) ?? []), sample]);
    }
  }

  const lines: string[] = [
    `\nCPU throttle ${CPU_THROTTLE}x, ${TASK_COUNT} tasks, ${ROUNDS} rounds, window ${WINDOW_MS}ms`,
  ];
  for (const view of VIEWS) {
    const samples = results.get(view)!;
    lines.push(
      `\n== ${view}`,
      `script ms/s median ${median(samples.map((s) => s.script)).toFixed(1)}  (${samples
        .map((s) => s.script.toFixed(1))
        .join(', ')})`,
      `task   ms/s median ${median(samples.map((s) => s.task)).toFixed(1)}  (${samples
        .map((s) => s.task.toFixed(1))
        .join(', ')})`,
    );
    const types = new Set(samples.flatMap((s) => Object.keys(s.dispatches)));
    const disp = [...types]
      .map((t) => [t, median(samples.map((s) => s.dispatches[t] ?? 0))] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    lines.push(
      `dispatches/s: ${disp.map(([t, v]) => `${t}=${v.toFixed(2)}`).join('  ')}`,
    );
    const keys = new Set(samples.flatMap((s) => [...s.self.keys()]));
    const top = [...keys]
      .map((k) => [k, median(samples.map((s) => s.self.get(k) ?? 0))] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);
    lines.push('top self ms/s (median):');
    top.forEach(([k, v]) => lines.push(`  ${v.toFixed(1).padStart(7)}  ${k}`));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(lines.join('\n'));
});
