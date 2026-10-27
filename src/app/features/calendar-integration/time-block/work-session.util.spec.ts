import {
  INITIAL_WORK_SESSION_STEP,
  MAX_PENDING_WORK_SESSIONS,
  NO_STORED_WORK_SESSIONS,
  recordWorkSessionStep,
  recoverInterruptedWorkSession,
  removePendingWorkSession,
  stepWorkSession,
} from './work-session.util';

describe('stepWorkSession', () => {
  const a = { id: 'a', title: 'A', timeSpent: 0 };
  const b = { id: 'b', title: 'B', timeSpent: 0 };

  it('opens a session when a task becomes current', () => {
    const step = stepWorkSession(INITIAL_WORK_SESSION_STEP, a, 100);
    expect(step).toEqual({
      open: { taskId: 'a', title: 'A', start: 100, startTimeSpent: 0, timeSpent: 0 },
      ended: null,
    });
  });

  it('ends the session when tracking stops', () => {
    const running = stepWorkSession(INITIAL_WORK_SESSION_STEP, a, 100);
    const ticked = stepWorkSession(running, { ...a, timeSpent: 400 }, 500);
    const step = stepWorkSession(ticked, null, 500);
    expect(step).toEqual({
      open: null,
      ended: { taskId: 'a', title: 'A', start: 100, end: 500 },
    });
  });

  it('ends one session and opens the next on a switch', () => {
    const running = stepWorkSession(INITIAL_WORK_SESSION_STEP, a, 100);
    const ticked = stepWorkSession(running, { ...a, timeSpent: 400 }, 500);
    const step = stepWorkSession(ticked, b, 500);
    expect(step.ended).toEqual({ taskId: 'a', title: 'A', start: 100, end: 500 });
    expect(step.open).toEqual({
      taskId: 'b',
      title: 'B',
      start: 500,
      startTimeSpent: 0,
      timeSpent: 0,
    });
  });

  it('ends the session where tracked time ends when idle time was removed', () => {
    const running = stepWorkSession(INITIAL_WORK_SESSION_STEP, a, 100);
    // idle detection untracks the idle stretch, then stops tracking
    const untracked = stepWorkSession(running, { ...a, timeSpent: 1000 }, 5000);
    const step = stepWorkSession(untracked, null, 5000);
    expect(step.ended).toEqual({ taskId: 'a', title: 'A', start: 100, end: 1100 });
  });

  it('keeps the start and takes the latest title for the same task', () => {
    const running = stepWorkSession(INITIAL_WORK_SESSION_STEP, a, 100);
    const step = stepWorkSession(running, { id: 'a', title: 'A2', timeSpent: 200 }, 300);
    expect(step).toEqual({
      open: { taskId: 'a', title: 'A2', start: 100, startTimeSpent: 0, timeSpent: 200 },
      ended: null,
    });
  });

  it('ends nothing when no session is open', () => {
    expect(stepWorkSession(INITIAL_WORK_SESSION_STEP, null, 100)).toEqual(
      INITIAL_WORK_SESSION_STEP,
    );
  });
});

describe('stored work sessions', () => {
  const MIN = 60 * 1000;
  const open = {
    taskId: 'a',
    title: 'A',
    start: 0,
    startTimeSpent: 5 * MIN,
    timeSpent: 35 * MIN,
  };
  const TEN_MIN = 10 * MIN;
  const session = (
    start: number,
  ): { taskId: string; title: string; start: number; end: number } => ({
    taskId: 'a',
    title: 'A',
    start,
    end: start + TEN_MIN,
  });

  it('keeps the running session and queues the one that ended', () => {
    const stored = recordWorkSessionStep(NO_STORED_WORK_SESSIONS, {
      open,
      ended: session(0),
    });
    expect(stored).toEqual({ open, pending: [session(0)] });
  });

  it('does not queue sessions shorter than a minute', () => {
    const short = { taskId: 'a', title: 'A', start: 0, end: MIN - 1 };
    const stored = recordWorkSessionStep(NO_STORED_WORK_SESSIONS, {
      open: null,
      ended: short,
    });
    expect(stored.pending).toEqual([]);
  });

  it('keeps only the newest sessions when too many are pending', () => {
    let stored = NO_STORED_WORK_SESSIONS;
    for (let i = 0; i <= MAX_PENDING_WORK_SESSIONS; i++) {
      stored = recordWorkSessionStep(stored, { open: null, ended: session(i * MIN) });
    }
    expect(stored.pending.length).toBe(MAX_PENDING_WORK_SESSIONS);
    expect(stored.pending[0]).toEqual(session(MIN));
  });

  it('turns a session cut short by a quit or crash into a pending one', () => {
    const stored = recoverInterruptedWorkSession({ open, pending: [] }, 99 * MIN);
    expect(stored).toEqual({
      open: null,
      pending: [{ taskId: 'a', title: 'A', start: 0, end: 30 * MIN }],
    });
  });

  it('leaves storage alone when no session was cut short', () => {
    const stored = { open: null, pending: [session(0)] };
    expect(recoverInterruptedWorkSession(stored, 99 * MIN)).toBe(stored);
  });

  it('removes a written session by task and start', () => {
    const stored = { open, pending: [session(0), session(20 * MIN)] };
    expect(removePendingWorkSession(stored, session(0))).toEqual({
      open,
      pending: [session(20 * MIN)],
    });
  });
});
