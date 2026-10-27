import { INITIAL_WORK_SESSION_STEP, stepWorkSession } from './work-session.util';

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
