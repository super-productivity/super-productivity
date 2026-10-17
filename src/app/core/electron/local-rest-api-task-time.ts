import { isValidDBDateStr } from '../../util/get-db-date-str';
import { isRecord } from './local-rest-api-body';

export const MAX_TIME_SPENT_PER_DAY_MS = 24 * 60 * 60 * 1000;

/** Shared validation for adding time (POST) and setting a day's total (PUT). */
export const parseTimeSpentBody = (
  body: unknown,
  todayStr: string,
  method: 'POST' | 'PUT',
): { date: string; duration: number } | { code: string; error: string } => {
  if (!isRecord(body)) {
    return {
      code: 'INVALID_INPUT',
      error: 'Body must be a JSON object with date and duration',
    };
  }
  const unknownField = Object.keys(body).find((k) => k !== 'date' && k !== 'duration');
  if (unknownField) {
    return {
      code: 'UNSUPPORTED_FIELD',
      error: `${unknownField} is not supported — only date and duration`,
    };
  }
  const { date, duration } = body;
  if (typeof date !== 'string' || !isValidDBDateStr(date)) {
    return { code: 'INVALID_INPUT', error: 'date must be a valid YYYY-MM-DD date' };
  }
  if (date > todayStr) {
    return { code: 'INVALID_INPUT', error: 'date must not be after today' };
  }
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < (method === 'PUT' ? 0 : 1) ||
    duration > MAX_TIME_SPENT_PER_DAY_MS
  ) {
    const range = method === 'PUT' ? 'non-negative' : 'positive';
    return {
      code: 'INVALID_INPUT',
      error: `duration must be a ${range} integer of milliseconds, at most 24h`,
    };
  }
  return { date, duration };
};
