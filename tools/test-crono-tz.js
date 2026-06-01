#!/usr/bin/env node
/**
 * Cross-timezone verification of the cron day-resolution the occurrence engine
 * relies on. The Karma suite can only run in the host timezone (Chrome on
 * Windows ignores the TZ env var), so this harness spawns a child Node process
 * per timezone — Node/V8 *does* honor TZ — and asserts day-class invariants
 * that must hold in every zone, including fractional offsets (India +05:30,
 * Chatham +12:45/+13:45) and Southern-hemisphere DST (Sydney).
 *
 * It mirrors getNextCronOccurrence's core math (seed 1 ms before the next day's
 * midnight, take cron-parser's next(), normalize to noon, read the local day).
 *
 * Usage:  node tools/test-crono-tz.js
 */
const { execFileSync } = require('child_process');
const { CronExpressionParser } = require('cron-parser');

const ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/Berlin',
  'Asia/Kolkata', // +05:30 (fractional)
  'Asia/Tokyo',
  'Australia/Sydney', // Southern-hemisphere DST
  'Pacific/Chatham', // +12:45 / +13:45 (fractional + DST)
];

const RESET = '\x1b[0m';
const RED = (s) => `\x1b[31m${s}${RESET}`;
const GREEN = (s) => `\x1b[32m${s}${RESET}`;

// ---- child: run the invariant battery in the current (TZ-env) timezone ----
function runBattery() {
  const fails = [];
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  // Mirror of getNextCronOccurrence's seeding + noon normalization.
  const nextDay = (cron, from) => {
    const lb = startOfDay(from);
    lb.setDate(lb.getDate() + 1);
    const cursor = new Date(lb.getTime() - 1);
    const d = CronExpressionParser.parse(cron, { currentDate: cursor }).next().toDate();
    d.setHours(12, 0, 0, 0);
    return d;
  };
  const dayStr = (d) =>
    `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;

  // Reference dates spread across the year (incl. both DST seasons).
  const refs = [
    new Date(2024, 0, 3, 12),
    new Date(2024, 2, 9, 12),
    new Date(2024, 5, 15, 12),
    new Date(2024, 9, 20, 12),
    new Date(2024, 11, 28, 12),
  ];

  for (const ref of refs) {
    // weekly Monday → resolved day is always a Monday
    const mon = nextDay('0 0 0 ? * MON', ref);
    if (mon.getDay() !== 1)
      fails.push(`weekly-MON not Monday from ${dayStr(ref)} → ${dayStr(mon)}`);
    // weekly Monday at 9am → still a Monday (time-of-day must not shift the day)
    const mon9 = nextDay('0 0 9 ? * MON', ref);
    if (mon9.getDay() !== 1)
      fails.push(`MON-9am not Monday from ${dayStr(ref)} → ${dayStr(mon9)}`);
    // monthly day-15 → day-of-month is always 15
    const d15 = nextDay('0 0 0 15 * ?', ref);
    if (d15.getDate() !== 15)
      fails.push(`day-15 not 15 from ${dayStr(ref)} → ${dayStr(d15)}`);
    // daily → strictly the next calendar day
    const daily = nextDay('0 0 0 * * ?', ref);
    const expected = startOfDay(ref);
    expected.setDate(expected.getDate() + 1);
    if (dayStr(daily) !== dayStr(expected))
      fails.push(
        `daily not +1 from ${dayStr(ref)} → ${dayStr(daily)} (want ${dayStr(expected)})`,
      );
  }

  // Full-year iteration of a daily-midnight cron: monotonic, all distinct days,
  // exactly 366 fires in a leap year — exercises every DST transition in-zone.
  try {
    const it = CronExpressionParser.parse('0 0 0 * * ?', {
      currentDate: new Date(2024, 0, 1, 0, 0, 0, -1),
    });
    const seen = new Set();
    let prev = -Infinity;
    let count = 0;
    for (;;) {
      const t = it.next().toDate();
      if (t.getFullYear() > 2024) break;
      if (t.getTime() <= prev) {
        fails.push(`daily not monotonic at ${dayStr(t)}`);
        break;
      }
      prev = t.getTime();
      t.setHours(12, 0, 0, 0);
      seen.add(dayStr(t));
      count++;
      if (count > 400) break;
    }
    if (seen.size !== 366)
      fails.push(`daily distinct days = ${seen.size}, expected 366 (leap year)`);
  } catch (e) {
    fails.push(`year iteration threw: ${e.message}`);
  }

  // getNewestPossibleCronDueDate's DST-safe day predicate: a daily cron must
  // "fire on" EVERY calendar day of the year — including each zone's DST
  // transition days. This is the regression guard for the prev() spring-forward
  // skip that previously made getNewest report the day before.
  const firesOnDay = (cron, day) => {
    const ds = startOfDay(day);
    const de = startOfDay(day);
    de.setDate(de.getDate() + 1);
    const it = CronExpressionParser.parse(cron, {
      currentDate: new Date(ds.getTime() - 1),
    });
    const n = it.next().toDate().getTime();
    return n >= ds.getTime() && n < de.getTime();
  };
  const probe = new Date(2024, 0, 1, 12);
  for (let i = 0; i < 366; i++) {
    if (!firesOnDay('0 0 0 * * ?', probe)) fails.push(`daily missed ${dayStr(probe)}`);
    probe.setDate(probe.getDate() + 1);
  }

  return fails;
}

if (process.env.CRONO_TZ_CHILD === '1') {
  process.stdout.write(JSON.stringify(runBattery()));
  process.exit(0);
}

// ---- parent: spawn one child per zone ----
let total = 0;
for (const tz of ZONES) {
  let out;
  try {
    out = execFileSync(process.execPath, [__filename], {
      env: { ...process.env, TZ: tz, CRONO_TZ_CHILD: '1' },
      encoding: 'utf8',
    });
  } catch (e) {
    console.log(RED(`  ${tz}: child crashed — ${e.message}`));
    total++;
    continue;
  }
  const fails = JSON.parse(out || '[]');
  if (fails.length) {
    console.log(RED(`  ${tz}: ${fails.length} failure(s)`));
    fails.slice(0, 8).forEach((f) => console.log(`      ${f}`));
    total += fails.length;
  } else {
    console.log(GREEN(`  ${tz}: OK`));
  }
}

console.log(
  total === 0
    ? GREEN(`\nDay-class invariants hold across ${ZONES.length} timezones\n`)
    : RED(`\n${total} cross-timezone failure(s)\n`),
);
process.exit(total === 0 ? 0 : 1);
