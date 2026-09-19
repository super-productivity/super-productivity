import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { editTimeSession } from './time-session-edit.util';
import { sessionClock, sessionStart, mergeTimeSession } from './time-session.util';

const day = '2026-09-13';
const session = {
  id: 'recording',
  d: day,
  s: Date.parse('2026-09-13T08:00:00Z'),
  t: 1800000,
  o: -120,
};
const task = {
  ...DEFAULT_TASK,
  id: 'task',
  projectId: 'INBOX',
  timeSessions: [session],
  timeSpentOnDay: { [day]: 600000 },
} as Task;

describe('Explicit time session edits', () => {
  it('preserves a negative correction when a recording duration is edited', () => {
    const changes = editTimeSession(task, day, session.id, { ...session, t: 2400000 });
    expect(changes.timeSpentOnDay![day]).toBe(1200000);
    expect(task.timeSessions).toEqual([session]);
  });
  it('clamps the day total when a recording is removed', () => {
    const changes = editTimeSession(task, day, session.id, undefined);
    expect(changes.timeSpentOnDay![day]).toBe(0);
    expect(changes.timeSessions).toEqual([]);
  });
  it('adds a duration-only session without inventing a timestamp', () => {
    const changes = editTimeSession(task, day, undefined, {
      id: 'manual',
      d: day,
      t: 60000,
    });
    expect(changes.timeSpentOnDay![day]).toBe(660000);
    expect(changes.timeSessions![1].s).toBeUndefined();
  });
  it('refuses a stale deletion or mismatched day', () => {
    expect(editTimeSession(task, day, 'deleted-elsewhere', undefined)).toEqual({});
    expect(
      editTimeSession(task, day, session.id, { ...session, d: '2026-09-14' }),
    ).toEqual({});
  });
  it('displays the original wall clock after travel', () => {
    expect(sessionClock(session)).toBe('10:00');
    expect(sessionClock(session, true)).toBe('10:30');
    expect(sessionStart(day, '10:00', -120)).toBe(session.s);
    expect(sessionStart(day, '25:00', -120)).toBeUndefined();
  });
  it('does not duplicate or shorten annotations when replaying an older checkpoint', () => {
    expect(mergeTimeSession([session], { ...session, t: 60000 })).toEqual([session]);
    expect(mergeTimeSession([session], session)).toEqual([session]);
  });
});
