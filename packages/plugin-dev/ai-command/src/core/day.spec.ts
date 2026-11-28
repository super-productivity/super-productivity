import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  canAddToToday,
  dayLabel,
  freeMinutesToday,
  isDayStr,
  logicalDayOf,
  minutesLabel,
  plannedDayOf,
  plannedMinutesToday,
  whenOf,
} from './day';
import { DAY, TODAY, localTs, task } from './test-fixtures';

const H = 3_600_000;

test('isDayStr accepts real dates only', () => {
  assert.equal(isDayStr('2026-11-03'), true);
  assert.equal(isDayStr('2026-02-30'), false);
  assert.equal(isDayStr('2026-1-3'), false);
  assert.equal(isDayStr('tomorrow'), false);
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('logicalDayOf honours the start-of-next-day offset', () => {
  const lateNight = localTs('2026-11-04', 1);
  assert.equal(logicalDayOf(lateNight, 0), '2026-11-04');
  assert.equal(logicalDayOf(lateNight, 4 * H), '2026-11-03');
});

test('a fixed time wins over dueDay', () => {
  const t = task('a', { dueDay: '2026-11-10', dueWithTime: localTs(TODAY, 15) });
  assert.equal(plannedDayOf(t, DAY), TODAY);
  assert.equal(whenOf(t, DAY), 'today');
  assert.equal(whenOf(task('b', { dueDay: '2026-11-01' }), DAY), 'overdue');
  assert.equal(whenOf(task('c', { dueDay: '2026-11-05' }), DAY), 'later');
  assert.equal(whenOf(task('d'), DAY), 'unplanned');
});

test('dayLabel names near days and dates', () => {
  assert.equal(dayLabel(null, TODAY), 'No day');
  assert.equal(dayLabel(TODAY, TODAY), 'Today');
  assert.equal(dayLabel('2026-11-04', TODAY), 'Tomorrow');
  assert.equal(dayLabel('2026-11-09', TODAY), 'Mon');
  assert.equal(dayLabel('2026-11-12', TODAY), 'Nov 12');
  assert.equal(dayLabel('2026-11-01', TODAY), 'Nov 1');
});

test('minutesLabel', () => {
  assert.equal(minutesLabel(45), '45 min');
  assert.equal(minutesLabel(120), '2 h');
  assert.equal(minutesLabel(90), '1 h 30 min');
});

test('freeMinutesToday subtracts tracked time once and timed tasks ahead', () => {
  const parent = task('p', { subTaskIds: ['s'], timeSpentOnDay: { [TODAY]: H } });
  const sub = task('s', { parentId: 'p', timeSpentOnDay: { [TODAY]: H } });
  const meeting = task('m', { dueWithTime: localTs(TODAY, 15), timeEstimate: H });
  const pastMeeting = task('pm', { dueWithTime: localTs(TODAY, 9), timeEstimate: H });
  assert.equal(freeMinutesToday([parent, sub, meeting, pastMeeting], DAY), 480 - 60 - 60);
  assert.equal(
    freeMinutesToday([task('x', { timeSpentOnDay: { [TODAY]: 10 * H } })], DAY),
    0,
  );
});

test('plannedMinutesToday counts open untimed top-level tasks for today', () => {
  const tasks = [
    task('a', { dueDay: TODAY, timeEstimate: 2 * H, timeSpent: H / 2 }),
    task('b', { dueDay: TODAY, timeEstimate: H, isDone: true }),
    task('c', { dueDay: TODAY, timeEstimate: H, parentId: 'a' }),
    task('d', { dueWithTime: localTs(TODAY, 15), timeEstimate: H }),
    task('e', { dueDay: '2026-11-04', timeEstimate: H }),
  ];
  assert.equal(plannedMinutesToday(tasks, DAY), 90);
});

test('canAddToToday offers only open tasks not already today and without a fixed time', () => {
  assert.equal(canAddToToday(task('a'), DAY), true);
  assert.equal(canAddToToday(task('a', { dueDay: '2026-11-01' }), DAY), true); // overdue
  assert.equal(canAddToToday(task('a', { dueDay: '2026-11-05' }), DAY), true);
  assert.equal(canAddToToday(task('a', { dueDay: TODAY }), DAY), false);
  assert.equal(canAddToToday(task('a', { isDone: true }), DAY), false);
  // A fixed time would be dropped by moving the plain day.
  assert.equal(
    canAddToToday(task('a', { dueWithTime: localTs('2026-11-05', 9) }), DAY),
    false,
  );
  assert.equal(canAddToToday(undefined, DAY), false);
});
