const ICAL_PREFIX = 'BEGIN:VCALENDAR';

export const isLikelyIcal = (body: unknown): boolean =>
  typeof body === 'string' &&
  body.trimStart().slice(0, ICAL_PREFIX.length).toUpperCase() === ICAL_PREFIX;

export class NotIcalResponseError extends Error {
  override name = 'NotIcalResponseError';
  constructor() {
    super('Response did not look like iCal data');
  }
}
