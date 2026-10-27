import { PluginWorkSession } from '@super-productivity/plugin-api';

/** Shorter sessions are accidental starts or quick switches, not work worth an event. */
export const MIN_WORK_SESSION_MS = 60 * 1000;

interface OpenWorkSession {
  taskId: string;
  title: string;
  start: number;
  /** Task time spent (ms) when the session started and at its latest emission */
  startTimeSpent: number;
  timeSpent: number;
}

export interface WorkSessionStep {
  open: OpenWorkSession | null;
  /** The session that ended with this step, if any */
  ended: PluginWorkSession | null;
}

export const INITIAL_WORK_SESSION_STEP: WorkSessionStep = { open: null, ended: null };

const endWorkSession = (open: OpenWorkSession, now: number): PluginWorkSession => {
  const tracked = open.timeSpent - open.startTimeSpent;
  return {
    taskId: open.taskId,
    title: open.title,
    start: open.start,
    end: Math.min(now, open.start + tracked),
  };
};

/**
 * Advance the session tracker by one emission of the current task. A session runs
 * while one task stays current; any change (stop, switch, task deleted) ends it.
 * It ends at `now`, or earlier where less time was tracked: idle detection removes
 * the idle stretch from the task before it stops tracking, and that stretch must
 * not end up in the calendar either.
 */
export const stepWorkSession = (
  prev: WorkSessionStep,
  currentTask: { id: string; title: string; timeSpent: number } | null,
  now: number,
): WorkSessionStep => {
  const open = prev.open;
  if (open && currentTask?.id === open.taskId) {
    // Same session; keep the latest title so a rename while tracking is reflected.
    return {
      open: { ...open, title: currentTask.title, timeSpent: currentTask.timeSpent },
      ended: null,
    };
  }
  return {
    open: currentTask
      ? {
          taskId: currentTask.id,
          title: currentTask.title,
          start: now,
          startTimeSpent: currentTask.timeSpent,
          timeSpent: currentTask.timeSpent,
        }
      : null,
    ended: open ? endWorkSession(open, now) : null,
  };
};
