import { TimeSession } from './time-session.model';
import { isValidDBDateStr } from '../../util/get-db-date-str';

export const isTimeSession = (value: unknown): value is TimeSession => {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    s['id'].length > 0 &&
    typeof s['d'] === 'string' &&
    isValidDBDateStr(s['d']) &&
    typeof s['t'] === 'number' &&
    Number.isFinite(s['t']) &&
    s['t'] >= 0 &&
    (s['s'] === undefined ||
      (typeof s['s'] === 'number' &&
        Number.isFinite(s['s']) &&
        Math.abs(s['s']) <= 8640000000000000)) &&
    (s['o'] === undefined ||
      (typeof s['o'] === 'number' && Number.isFinite(s['o']) && Math.abs(s['o']) <= 1440))
  );
};

/** A recording is extended by cumulative duration, never added twice after a checkpoint. */
export const mergeTimeSession = (
  sessions: readonly TimeSession[] = [],
  incoming: TimeSession,
): TimeSession[] => {
  const previous = sessions.find((s) => s.id === incoming.id);
  if (previous && previous.t >= incoming.t) return sessions as TimeSession[];
  return [...sessions.filter((s) => s.id !== incoming.id), incoming].sort(
    (a, b) =>
      (a.d < b.d ? -1 : a.d > b.d ? 1 : 0) ||
      (a.s ?? Infinity) - (b.s ?? Infinity) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
};

export const sessionClock = (session: TimeSession, end = false): string => {
  if (session.s === undefined) return '';
  const offsetMs = (session.o ?? new Date(session.s).getTimezoneOffset()) * 60000;
  const timestamp = session.s + (end ? session.t : 0);
  const date = new Date(timestamp - offsetMs);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
};

/** Interpret an edited wall time in the recording's original timezone. */
export const sessionStart = (
  day: string,
  clock: string,
  offset: number,
): number | undefined => {
  if (!/^\d{2}:\d{2}$/.test(clock) || !isValidDBDateStr(day)) return undefined;
  const [hours, minutes] = clock.split(':').map(Number);
  if (hours > 23 || minutes > 59) return undefined;
  const hourMinutes = hours * 60;
  const minutesFromUtcMidnight = hourMinutes + minutes + offset;
  const milliseconds = minutesFromUtcMidnight * 60000;
  return Date.parse(`${day}T00:00:00Z`) + milliseconds;
};
