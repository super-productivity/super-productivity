/**
 * Regenerates android/app/src/test/resources/repeat-reminder-fixtures.json
 * from getUpcomingRepeatReminders, the same function the open app uses, and
 * stores each case's configs as getRepeatCfgSnapshotForNative sends them.
 *
 *   node tools/generate-repeat-reminder-fixtures.mjs          # write
 *   node tools/generate-repeat-reminder-fixtures.mjs --check  # fail if drift
 *
 * Each case runs in a process whose TZ is set before Date is used, so the
 * timestamps do not depend on the machine zone. The Android port
 * (RepeatReminderSchedule.kt) is locked to this file.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(
  root,
  'android/app/src/test/resources/repeat-reminder-fixtures.json',
);
const require = createRequire(path.join(root, 'package.json'));

const LOOKAHEAD = 14;
const MAX = 32;

const base = (over) => ({
  id: 'cfg',
  title: 'Standup',
  projectId: null,
  isPaused: false,
  repeatCycle: 'DAILY',
  startDate: '2026-01-01',
  repeatEvery: 1,
  startTime: '09:00',
  remindAt: 'AtStart',
  lastTaskCreationDay: '2026-06-14',
  waitForCompletion: false,
  repeatFromCompletionDate: false,
  monthlyLastDay: false,
  deletedInstanceDates: [],
  sunday: false,
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  ...over,
});

/** now is 2026-06-15 15:00 UTC, so a 09:00 reminder today is already past. */
const NOW = '2026-06-15T15:00:00.000Z';

const cases = [
  {
    name: 'daily AtStart skips a past today and keeps the next 14 days',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [base({})],
    expectCount: 14,
  },
  {
    name: 'daily m30 is thirty minutes before the start',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [base({ remindAt: 'm30', startTime: '09:00' })],
    expectCount: 14,
    firstTrigger: '2026-06-16T08:30:00.000Z',
  },
  {
    name: 'weekly only the configured weekday',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'week',
        repeatCycle: 'WEEKLY',
        startDate: '2026-06-01',
        tuesday: true,
      }),
    ],
    expectCount: 2,
  },
  {
    name: 'weekly every two weeks',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'biweek',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        startDate: '2026-06-02',
        tuesday: true,
      }),
    ],
    expectCount: 1,
  },
  {
    name: 'monthly day of month',
    timeZone: 'UTC',
    now: '2026-06-10T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'month',
        repeatCycle: 'MONTHLY',
        startDate: '2026-01-20',
        lastTaskCreationDay: '2026-05-20',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_month_2026-06-20',
  },
  {
    name: 'monthly last day',
    timeZone: 'UTC',
    now: '2026-06-20T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'eom',
        repeatCycle: 'MONTHLY',
        monthlyLastDay: true,
        startDate: '2026-01-31',
        lastTaskCreationDay: '2026-05-31',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_eom_2026-06-30',
  },
  {
    name: 'monthly second Tuesday',
    timeZone: 'UTC',
    now: '2026-06-01T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'nth',
        repeatCycle: 'MONTHLY',
        monthlyWeekOfMonth: 2,
        monthlyWeekday: 2,
        startDate: '2026-01-13',
        lastTaskCreationDay: '2026-05-12',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_nth_2026-06-09',
  },
  {
    name: 'yearly',
    timeZone: 'UTC',
    now: '2026-06-01T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'year',
        repeatCycle: 'YEARLY',
        startDate: '2020-06-10',
        lastTaskCreationDay: '2025-06-10',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_year_2026-06-10',
  },
  {
    name: 'monthly day 31 clamps to June 30',
    timeZone: 'UTC',
    now: '2026-06-20T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'm31',
        repeatCycle: 'MONTHLY',
        startDate: '2026-01-31',
        lastTaskCreationDay: '2026-05-31',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_m31_2026-06-30',
  },
  {
    name: 'monthly day 31 clamps to February 28',
    timeZone: 'UTC',
    now: '2026-02-20T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'm31',
        repeatCycle: 'MONTHLY',
        startDate: '2026-01-31',
        lastTaskCreationDay: '2026-01-31',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_m31_2026-02-28',
  },
  {
    name: 'yearly February 29 in a non-leap year',
    timeZone: 'UTC',
    now: '2027-02-20T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'leap',
        repeatCycle: 'YEARLY',
        startDate: '2024-02-29',
        lastTaskCreationDay: '2026-02-28',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_leap_2027-02-28',
  },
  {
    name: 'monthly last Friday',
    timeZone: 'UTC',
    now: '2026-06-20T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'lastfri',
        repeatCycle: 'MONTHLY',
        monthlyWeekOfMonth: -1,
        monthlyWeekday: 5,
        startDate: '2026-01-30',
        lastTaskCreationDay: '2026-05-29',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_lastfri_2026-06-26',
  },
  {
    name: 'monthly every 2 months skips the off month',
    timeZone: 'UTC',
    now: '2026-06-10T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'm2',
        repeatCycle: 'MONTHLY',
        repeatEvery: 2,
        startDate: '2026-01-15',
        lastTaskCreationDay: '2026-05-15',
      }),
    ],
    expectCount: 0,
  },
  {
    name: 'monthly every 2 months fires in the on month',
    timeZone: 'UTC',
    now: '2026-07-10T15:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'm2',
        repeatCycle: 'MONTHLY',
        repeatEvery: 2,
        startDate: '2026-01-15',
        lastTaskCreationDay: '2026-05-15',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_m2_2026-07-15',
  },
  {
    // 23:30 Los Angeles time on July 1 is already July 2 in UTC.
    name: 'monthly late evening in America/Los_Angeles',
    timeZone: 'America/Los_Angeles',
    now: '2026-06-30T20:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'la',
        repeatCycle: 'MONTHLY',
        startTime: '23:30',
        startDate: '2026-01-01',
        lastTaskCreationDay: '2026-06-01',
      }),
    ],
    expectCount: 1,
    firstId: 'rpt_la_2026-07-01',
    firstTrigger: '2026-07-02T06:30:00.000Z',
  },
  {
    name: 'paused wait missing time DoNotRemind and repeatEvery 0 schedule nothing',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({ id: 'paused', isPaused: true }),
      base({ id: 'wait', waitForCompletion: true }),
      base({ id: 'notime', startTime: null }),
      base({ id: 'noremind', remindAt: null }),
      base({ id: 'dont', remindAt: 'DoNotRemind' }),
      base({ id: 'zero', repeatEvery: 0 }),
    ],
    expectCount: 0,
  },
  {
    name: 'deleted instance day is skipped',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [base({ deletedInstanceDates: ['2026-06-16'] })],
    expectCount: 13,
    absentId: 'rpt_cfg_2026-06-16',
  },
  {
    name: 'last creation day in the future skips until after it',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [base({ lastTaskCreationDay: '2026-06-20' })],
    expectCount: 9,
    absentId: 'rpt_cfg_2026-06-20',
    firstId: 'rpt_cfg_2026-06-21',
  },
  {
    name: 'repeat until day cuts the window',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [base({ repeatUntilDay: '2026-06-18' })],
    expectCount: 3,
  },
  {
    name: 'archived project is excluded and an unassigned config is kept',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: ['p-arch'],
    cfgs: [
      base({ id: 'in-arch', projectId: 'p-arch' }),
      base({ id: 'free', projectId: null }),
    ],
    expectCount: 14,
    firstId: 'rpt_free_2026-06-16',
  },
  {
    name: 'start of next day moves 02:00 onto the next calendar day',
    timeZone: 'UTC',
    now: '2026-06-15T00:30:00.000Z',
    startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [base({ id: 'early', startTime: '02:00', lastTaskCreationDay: '2026-06-14' })],
    // The window starts on logical 06-14, which is already created.
    expectCount: 14,
    firstId: 'rpt_early_2026-06-15',
    firstTrigger: '2026-06-16T02:00:00.000Z',
  },
  {
    name: 'after midnight but before start of day keeps the logical day occurrence',
    timeZone: 'UTC',
    now: '2026-06-15T00:15:00.000Z',
    startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [base({ id: 'night', startTime: '01:00', lastTaskCreationDay: '2026-06-13' })],
    expectCount: 15,
    firstId: 'rpt_night_2026-06-14',
    firstTrigger: '2026-06-15T01:00:00.000Z',
  },
  {
    name: 'cap keeps 32 nearest ranks when many dailies compete',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: Array.from({ length: 40 }, (_, i) =>
      base({ id: `d${String(i).padStart(2, '0')}`, title: `D${i}` }),
    ),
    expectCount: 32,
    firstId: 'rpt_d00_2026-06-16',
  },
  {
    name: 'soonest first fills the cap by time',
    timeZone: 'UTC',
    now: NOW,
    startOfNextDayDiffMs: 0,
    soonestFirst: true,
    archivedProjectIds: [],
    cfgs: [
      base({ id: 'late', startTime: '18:00' }),
      base({ id: 'early', startTime: '10:00' }),
    ],
    expectCount: 29,
    firstId: 'rpt_late_2026-06-15',
  },
  {
    name: 'Europe/Berlin spring-forward rolls a 02:30 clock',
    timeZone: 'Europe/Berlin',
    now: '2026-03-28T12:00:00.000Z',
    startOfNextDayDiffMs: 0,
    soonestFirst: false,
    archivedProjectIds: [],
    cfgs: [
      base({
        id: 'dst',
        startTime: '02:30',
        startDate: '2026-03-01',
        lastTaskCreationDay: '2026-03-28',
      }),
    ],
    expectCount: 14,
    dstDay: '2026-03-29',
    dstHour: 3,
    dstMinute: 30,
  },
];

async function bundle() {
  const esbuild = require('esbuild');
  const outfile = path.join(os.tmpdir(), 'repeat-upcoming-fixture.mjs');
  // The date function pulls NgRx and, through it, Angular and the sync
  // packages. Those are never called for a reminder. A proxy satisfies every
  // named import so the bundle can load without a package build.
  const stubPlugin = {
    name: 'stub-unused-packages',
    setup(build) {
      build.onResolve({ filter: /^@angular\/|^@sp\// }, (args) => ({
        path: args.path,
        namespace: 'stub-unused-packages',
      }));
      build.onLoad({ filter: /.*/, namespace: 'stub-unused-packages' }, () => ({
        loader: 'js',
        contents: `
          const fn = function () { return proxy; };
          const proxy = new Proxy(fn, {
            get: () => proxy,
            apply: () => proxy,
            construct: () => proxy,
            // esbuild's CJS-to-ESM helper copies own keys and inherits the
            // prototype. Inheriting the proxy makes every later property a proxy.
            getPrototypeOf: () => proxy,
          });
          module.exports = proxy;
        `,
      }));
    },
  };
  await esbuild.build({
    absWorkingDir: root,
    // Both functions in one bundle: cases reach Kotlin through the app's own
    // snapshot, so the bridge format is checked along with the schedule.
    stdin: {
      contents: [
        "export { getUpcomingRepeatReminders } from './src/app/features/task-repeat-cfg/get-upcoming-repeat-reminders';",
        "export { getRepeatCfgSnapshotForNative } from './src/app/features/android/store/get-repeat-cfg-snapshot-for-native';",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    plugins: [stubPlugin],
    logLevel: 'silent',
  });
  return outfile;
}

function runWorker(bundlePath, timeZone, group) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', bundlePath], {
      env: { ...process.env, TZ: timeZone },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`fixture worker for ${timeZone} exited ${code}`));
        return;
      }
      resolve(JSON.parse(out));
    });
    child.stdin.end(JSON.stringify(group));
  });
}

async function workerMain(bundlePath) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  // The bundled import graph touches a few browser globals at load. The
  // reminder function itself only uses Date.
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  if (globalThis.document == null) {
    globalThis.document = { documentElement: { style: {} } };
  }
  if (globalThis.localStorage == null) {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  // The real function logs when it caps. Keep that off stdout, which is the
  // JSON result the parent reads.
  console.log = (...args) => console.error(...args);
  const mod = await import(pathToFileUrl(bundlePath));
  const results = input.map((entry) => {
    const got = mod.getUpcomingRepeatReminders(
      entry.cfgs,
      Date.parse(entry.now),
      entry.startOfNextDayDiffMs,
      {
        lookaheadDays: LOOKAHEAD,
        maxScheduled: MAX,
        soonestFirst: entry.soonestFirst,
      },
      new Set(entry.archivedProjectIds),
    );
    if (got.length !== entry.expectCount) {
      throw new Error(`${entry.name}: expected ${entry.expectCount} reminders, got ${got.length}`);
    }
    if (entry.firstId && got[0]?.taskId !== entry.firstId) {
      throw new Error(`${entry.name}: first id ${got[0]?.taskId} !== ${entry.firstId}`);
    }
    if (entry.firstTrigger && got[0]?.triggerAtMs !== Date.parse(entry.firstTrigger)) {
      throw new Error(
        `${entry.name}: first trigger ${new Date(got[0]?.triggerAtMs).toISOString()} !== ${entry.firstTrigger}`,
      );
    }
    if (entry.absentId && got.some((row) => row.taskId === entry.absentId)) {
      throw new Error(`${entry.name}: ${entry.absentId} should be absent`);
    }
    if (entry.dstDay) {
      const row = got.find((item) => item.taskId.endsWith(`_${entry.dstDay}`));
      if (!row) throw new Error(`${entry.name}: no occurrence on ${entry.dstDay}`);
      const local = new Date(row.triggerAtMs);
      if (local.getHours() !== entry.dstHour || local.getMinutes() !== entry.dstMinute) {
        throw new Error(
          `${entry.name}: ${entry.dstDay} local ${local.getHours()}:${local.getMinutes()} !== ${entry.dstHour}:${entry.dstMinute}`,
        );
      }
    }
    return {
      snapshot: JSON.parse(
        mod.getRepeatCfgSnapshotForNative(entry.cfgs, new Set(entry.archivedProjectIds)),
      ),
      expect: got.map(({ taskId, triggerAtMs, title }) => ({
        taskId,
        triggerAtMs,
        title,
      })),
    };
  });
  process.stdout.write(JSON.stringify(results));
}

function pathToFileUrl(file) {
  return new URL(`file://${file}`);
}

async function buildFixture() {
  const bundlePath = await bundle();
  const byZone = new Map();
  cases.forEach((entry, index) => {
    const list = byZone.get(entry.timeZone) ?? [];
    list.push({ index, entry });
    byZone.set(entry.timeZone, list);
  });
  const solved = new Array(cases.length);
  for (const [timeZone, group] of byZone) {
    const results = await runWorker(
      bundlePath,
      timeZone,
      group.map((item) => item.entry),
    );
    results.forEach(({ snapshot, expect }, i) => {
      const { entry } = group[i];
      solved[group[i].index] = {
        name: entry.name,
        timeZone: entry.timeZone,
        now: Date.parse(entry.now),
        startOfNextDayDiffMs: entry.startOfNextDayDiffMs,
        soonestFirst: entry.soonestFirst,
        snapshot,
        expect,
      };
    });
  }
  return {
    lookaheadDays: LOOKAHEAD,
    maxScheduled: MAX,
    cases: solved,
  };
}

const workerFlag = process.argv.indexOf('--worker');
if (workerFlag !== -1) {
  await workerMain(process.argv[workerFlag + 1]);
} else {
  const fixture = await buildFixture();
  const text = JSON.stringify(fixture, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const current = fs.readFileSync(fixturePath, 'utf8');
    if (current !== text) {
      console.error('repeat-reminder-fixtures.json does not match the app functions; regenerate it');
      process.exit(1);
    }
    console.log(`repeat reminder fixtures match (${fixture.cases.length} cases)`);
  } else {
    fs.writeFileSync(fixturePath, text);
    console.log(`wrote ${fixturePath} (${fixture.cases.length} cases)`);
  }
}
