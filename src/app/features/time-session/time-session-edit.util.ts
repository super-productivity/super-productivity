import { Task } from '../tasks/task.model';
import { TimeSession } from './time-session.model';
import { isTimeSession } from './time-session.util';

/** Explicit session edits change the day total by the same delta, preserving corrections. */
export const editTimeSession = (
  task: Task,
  day: string,
  previousId: string | undefined,
  replacement: TimeSession | undefined,
): Partial<Task> => {
  const sessions = task.timeSessions ?? [];
  const previous = previousId
    ? sessions.find((s) => s.id === previousId && s.d === day)
    : undefined;
  if (previousId && !previous) return {};
  if (replacement && (!isTimeSession(replacement) || replacement.d !== day)) return {};
  const updated = sessions.filter((s) => s.id !== previousId);
  if (replacement) updated.push(replacement);
  return {
    timeSessions: updated,
    timeSpentOnDay: {
      ...task.timeSpentOnDay,
      [day]: Math.max(
        0,
        (task.timeSpentOnDay[day] ?? 0) + (replacement?.t ?? 0) - (previous?.t ?? 0),
      ),
    },
  };
};
