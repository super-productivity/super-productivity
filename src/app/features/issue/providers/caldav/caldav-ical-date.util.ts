import { getDbDateStr } from '../../../../util/get-db-date-str';

/**
 * Canonical CalDAV date value, identical on push (task -> VTODO) and pull
 * (VTODO -> baseline), so two-way sync's strict-equality checks see a round
 * trip as unchanged:
 * - all-day (`VALUE=DATE`): `'YYYY-MM-DD'`
 * - timed (`DATE-TIME`): epoch ms truncated to whole seconds (iCal precision)
 * `null` means the property is absent. Never use `undefined`: JSON drops it,
 * which would turn a stored baseline into a permanent "no baseline".
 */
export type CaldavDateValue = string | number;

// ical.js is typed `any` upstream (see ical-lazy-loader.ts); these describe the
// small surface used here.
interface IcalTimeLike {
  isDate: boolean;
  year: number;
  month: number;
  day: number;
  toJSDate(): Date;
  convertToZone(zone: unknown): IcalTimeLike;
}

interface IcalPropertyLike {
  getFirstValue(): unknown;
  getParameter(name: string): unknown;
  setParameter(name: string, value: string): void;
  setValue(value: unknown): void;
}

export interface IcalComponentLike {
  getFirstSubcomponent(name: string): IcalComponentLike;
  getAllSubcomponents(name: string): IcalComponentLike[];
  getFirstProperty(name: string): IcalPropertyLike | null;
  getFirstPropertyValue(name: string): unknown;
  hasProperty(name: string): boolean;
  removeAllProperties(name: string): boolean;
  addProperty(property: IcalPropertyLike): unknown;
  toString(): string;
}

export interface IcalApiLike {
  parse(input: string): unknown;
  Component: new (jCal: unknown) => IcalComponentLike;
  Property: new (name: string) => IcalPropertyLike;
  Timezone: new (vtimezone: IcalComponentLike) => unknown;
  Time: {
    fromDateString(date: string): IcalTimeLike;
    fromJSDate(date: Date, useUTC: boolean): IcalTimeLike;
  };
}

export const truncateToSeconds = (ms: number): number => Math.floor(ms / 1000) * 1000;

/** From a mapped `CaldavIssue` (`start`/`due` epoch + all-day flag). */
export const toCaldavDateValue = (
  epochMs: number | undefined,
  isAllDay: boolean | undefined,
): CaldavDateValue | null => {
  if (epochMs === undefined || !Number.isFinite(epochMs)) {
    return null;
  }
  // All-day values arrive as local midnight (ical.js toJSDate), so the local
  // date is the calendar date; same conversion as getAddTaskData.
  return isAllDay ? getDbDateStr(epochMs) : truncateToSeconds(epochMs);
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

const readIcalDateValue = (prop: IcalPropertyLike | null): CaldavDateValue | null => {
  const time = prop?.getFirstValue() as IcalTimeLike | null | undefined;
  if (!time) {
    return null;
  }
  return time.isDate
    ? `${time.year}-${pad2(time.month)}-${pad2(time.day)}`
    : truncateToSeconds(time.toJSDate().getTime());
};

/**
 * Sets or removes DTSTART / DUE on a VTODO. Returns false (and leaves the VTODO
 * untouched) when the value already matches, so an unchanged date never bumps
 * SEQUENCE or the ETag (e.g. a reminder snooze re-sending the same deadline).
 *
 * Timezone rules: all-day values never carry a TZID. A timed value keeps an
 * existing TZID only when the calendar has that VTIMEZONE; otherwise it is
 * written as UTC. (Writing a zoned time without its definition would make the
 * instant depend on each reader's timezone.)
 */
export const applyIcalDate = (
  ical: IcalApiLike,
  vcalendar: IcalComponentLike,
  todo: IcalComponentLike,
  name: 'dtstart' | 'due',
  value: CaldavDateValue | null,
): boolean => {
  const current = todo.getFirstProperty(name);

  if (value === null) {
    if (!current) {
      return false;
    }
    todo.removeAllProperties(name);
    if (name === 'dtstart') {
      // RFC 5545: DURATION requires DTSTART.
      todo.removeAllProperties('duration');
    }
    return true;
  }

  if (readIcalDateValue(current) === value) {
    return false;
  }

  const prop = new ical.Property(name);
  if (typeof value === 'string') {
    prop.setValue(ical.Time.fromDateString(value));
  } else {
    const utc = ical.Time.fromJSDate(new Date(value), true);
    const tzidParam = current?.getParameter('tzid');
    const tzid = typeof tzidParam === 'string' ? tzidParam : null;
    const vtimezone = tzid
      ? vcalendar
          .getAllSubcomponents('vtimezone')
          .find((vtz) => vtz.getFirstPropertyValue('tzid') === tzid)
      : undefined;
    if (tzid && vtimezone) {
      prop.setValue(utc.convertToZone(new ical.Timezone(vtimezone)));
      prop.setParameter('tzid', tzid);
    } else {
      prop.setValue(utc);
    }
  }

  todo.removeAllProperties(name);
  todo.addProperty(prop);
  if (name === 'due') {
    // RFC 5545: DUE and DURATION must not both occur.
    todo.removeAllProperties('duration');
  }
  return true;
};
