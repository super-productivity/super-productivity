/**
 * Turns the harness reports into a pass/fail table (see run.sh).
 * Usage: node assert.js <dir with report-<phase>.json>
 */
const fs = require('fs');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
const PROBE_COUNT = 80;
// A daily repeat with free slots should be armed well past the old 14-day
// window; 30 leaves room for the slots other reminders take.
const MIN_REPEAT_DAYS = 30;
// run.sh could not terminate the app before the reminder was due.
const LATE = ' (not conclusive: the app was still running when it came due)';

const readReport = (dir, phase) => {
  const file = path.join(dir, `report-${phase}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};

const hasReminder = (list, reminderId) =>
  (list || []).some((n) => n.reminderId === reminderId);

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const isSame = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** What iOS kept when asked directly for more than the cap. */
const describeProbe = (probe) => {
  if (!probe) {
    return 'not measured';
  }
  const kept = probe.keptDaysAhead;
  const n = kept.length;
  const isSoonest = isSame(kept, range(1, n));
  const isFarthest = isSame(kept, range(PROBE_COUNT - n + 1, PROBE_COUNT));
  // Far-first adds the farthest first, so "first added" is the farthest there.
  const isFirstAdded = probe.isFarFirst ? isFarthest : isSoonest;
  const which = isSoonest
    ? 'the soonest'
    : isFirstAdded
      ? 'the first added'
      : isFarthest
        ? 'the last added'
        : `days ${kept.join(',')}`;
  return `kept ${n} of ${PROBE_COUNT} (${which}), ${probe.errors.length} schedule errors`;
};

const days = (ms, from) => ((ms - from) / DAY).toFixed(1);

const buildChecks = ({ baseline, cap, final, isLate }) => {
  const wanted = cap.wanted || [];
  const pending = cap.pendingOverCap || [];
  const dropped = wanted.filter((w) => !hasReminder(pending, w.reminderId));
  const latestPending = Math.max(0, ...pending.map((n) => n.at));
  const soonestDropped = Math.min(...dropped.map((w) => w.at));
  const seededAt = wanted.length ? wanted[wanted.length - 1].at - DAY : 0;

  return [
    {
      name: 'A reminder fires while the app is terminated',
      isOk:
        !isLate.baseline &&
        !!baseline.near?.isArmed &&
        hasReminder(cap.atLaunch?.delivered, 'simBaseline'),
      detail: `armed: ${!!baseline.near?.isArmed}, delivered before relaunch: ${hasReminder(cap.atLaunch?.delivered, 'simBaseline')}${isLate.baseline ? LATE : ''}`,
    },
    {
      name: `A daily repeat is armed at least ${MIN_REPEAT_DAYS} days ahead while slots are free`,
      isOk: (cap.repeat?.daysCovered ?? 0) >= MIN_REPEAT_DAYS,
      detail: `${cap.repeat?.count ?? 0} occurrences, ${(cap.repeat?.daysCovered ?? 0).toFixed(1)} days`,
    },
    {
      name: 'Over the cap, the dropped reminders are the farthest ones',
      isOk:
        wanted.length > 0 && (dropped.length === 0 || soonestDropped >= latestPending),
      detail: dropped.length
        ? `${pending.length} pending, ${dropped.length} of ${wanted.length} one-offs dropped; soonest dropped in ${days(soonestDropped, seededAt)} days, latest pending in ${days(latestPending, seededAt)} days`
        : `${pending.length} pending, none of ${wanted.length} one-offs dropped`,
    },
    {
      name: 'A reminder set while the cap is full is armed and fires',
      isOk:
        !isLate.cap &&
        !!cap.near?.isArmed &&
        hasReminder(final.atLaunch?.delivered, 'simNearUnderCap'),
      detail: `armed: ${!!cap.near?.isArmed}, delivered before relaunch: ${hasReminder(final.atLaunch?.delivered, 'simNearUnderCap')}${isLate.cap ? LATE : ''}`,
    },
    {
      name: 'A change that touches no reminder re-arms none',
      isOk: cap.rearm?.scheduleCalls === 0,
      detail: `${cap.rearm?.scheduleCalls ?? 'unknown'} schedule calls after adding a task without a reminder; ${cap.seeding?.scheduleCalls ?? 'unknown'} to arm ${wanted.length} reminders${cap.seeding?.isDrained === false ? ' (still arming at the timeout)' : ''}`,
    },
  ];
};

const main = () => {
  const dir = process.argv[2];
  const reports = {
    baseline: readReport(dir, 'baseline'),
    cap: readReport(dir, 'cap'),
    final: readReport(dir, 'final'),
    isLate: {
      baseline: fs.existsSync(path.join(dir, 'baseline-late')),
      cap: fs.existsSync(path.join(dir, 'cap-late')),
    },
  };
  const checks = buildChecks(reports);
  const lines = [
    '## iOS Simulator: reminders',
    '',
    '| | Check | Measured |',
    '| --- | --- | --- |',
    ...checks.map((c) => `| ${c.isOk ? 'PASS' : 'FAIL'} | ${c.name} | ${c.detail} |`),
    '',
    `Notification permission: ${reports.baseline.permission ?? 'unknown'}`,
    `iOS asked directly, far ones first: ${describeProbe(reports.baseline.osCapFarFirst)}`,
    `iOS asked directly, near ones first: ${describeProbe(reports.baseline.osCapNearFirst)}`,
    `Pending at the end of the cap phase: ${(reports.cap.pendingAtEnd || []).length}`,
    '',
  ];
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  }
  process.exit(checks.every((c) => c.isOk) ? 0 : 1);
};

main();
