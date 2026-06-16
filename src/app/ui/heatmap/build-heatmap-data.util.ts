import { DayData, HeatmapData, MonthBlock, WeekData } from './heatmap.component';
import { getDbDateStr } from '../../util/get-db-date-str';

/**
 * Lay a `dayMap` out into a GitHub-style week grid between `startDate` and
 * `endDate`. Extracted from RepeatTaskHeatmapComponent so the live RRULE preview
 * can reuse it. `monthNames` is the localized short month list (Jan…Dec).
 */
export const buildHeatmapWeeks = (
  dayMap: Map<string, DayData>,
  startDate: Date,
  endDate: Date,
  firstDayOfWeek: number,
  monthNames: string[],
): HeatmapData => {
  const weeks: WeekData[] = [];
  const monthLabels: string[] = [];
  let currentMonth = -1;

  // Back up to the first day of the week containing the start date.
  const firstDay = new Date(startDate);
  const daysToGoBack = (firstDay.getDay() - firstDayOfWeek + 7) % 7;
  firstDay.setDate(firstDay.getDate() - daysToGoBack);

  const currentDate = new Date(firstDay);
  let weekCount = 0;

  while (currentDate <= endDate || weeks.length === 0) {
    const week: WeekData = { days: [] };
    for (let i = 0; i < 7; i++) {
      const dateStr = getDbDateStr(currentDate);
      const dayData = dayMap.get(dateStr);

      if (currentDate >= startDate && currentDate <= endDate) {
        week.days.push(dayData || null);
        const month = currentDate.getMonth();
        if (month !== currentMonth && currentDate.getDate() <= 7 && weekCount > 0) {
          monthLabels.push(monthNames[month]);
          currentMonth = month;
        } else if (monthLabels.length === 0 && weekCount === 0) {
          monthLabels.push(monthNames[month]);
          currentMonth = month;
        }
      } else {
        week.days.push(null);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    weeks.push(week);
    weekCount++;
    if (weeks.length > 54) break;
  }

  return { weeks, monthLabels };
};

/**
 * Build a `dayMap` over `[from, to]` (inclusive) that marks the given occurrence
 * days as projected (level 1, `isProjected`). Used by the live RRULE preview to
 * render upcoming occurrences as a calendar without any past-activity data.
 */
export const buildProjectionDayMap = (
  occurrences: Date[],
  from: Date,
  to: Date,
): Map<string, DayData> => {
  const occSet = new Set(occurrences.map(getDbDateStr));
  const dayMap = new Map<string, DayData>();
  const cur = new Date(from);
  cur.setHours(12, 0, 0, 0);
  while (cur <= to) {
    const dateStr = getDbDateStr(cur);
    const isProjected = occSet.has(dateStr);
    dayMap.set(dateStr, {
      date: new Date(cur),
      dateStr,
      taskCount: 0,
      timeSpent: 0,
      level: isProjected ? 1 : 0,
      isProjected,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return dayMap;
};

/**
 * Group `[startDate, endDate]` into calendar months, laying each month's days
 * into its own weekday-row column grid (a mini calendar). `formatTotal` builds
 * the per-month label shown beneath the block from that month's day data — e.g.
 * total hours for an activity heatmap, or an occurrence count for a projection.
 */
export const buildHeatmapMonths = (
  dayMap: Map<string, DayData>,
  startDate: Date,
  endDate: Date,
  firstDayOfWeek: number,
  monthNames: string[],
  formatTotal: (days: DayData[]) => string,
): MonthBlock[] => {
  const blocks: MonthBlock[] = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  const currentYear = new Date().getFullYear();
  let labeledYear: number | null = null;

  while (cursor <= lastMonth) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const weeks: WeekData[] = [];
    const monthDays: DayData[] = [];
    let column: WeekData = { days: [] };
    // Pad the first column so day-of-week rows line up.
    const lead = (new Date(year, month, 1).getDay() - firstDayOfWeek + 7) % 7;
    for (let p = 0; p < lead; p++) column.days.push(null);

    for (let d = 1; d <= daysInMonth; d++) {
      const dd = dayMap.get(getDbDateStr(new Date(year, month, d))) ?? null;
      column.days.push(dd);
      if (dd) monthDays.push(dd);
      if (column.days.length === 7) {
        weeks.push(column);
        column = { days: [] };
      }
    }
    if (column.days.length) {
      while (column.days.length < 7) column.days.push(null);
      weeks.push(column);
    }

    // A rolling window can span the same month twice (e.g. two Junes a year
    // apart) — year-stamp the first block of each year so they're tellable
    // apart. The CURRENT year stays plain ("Jun", not "Jun 2026"): it's the
    // implied default, and the next year's stamp marks the boundary.
    const label =
      year !== labeledYear && year !== currentYear
        ? `${monthNames[month]} ${year}`
        : monthNames[month];
    labeledYear = year;
    blocks.push({ label, total: formatTotal(monthDays), weeks, monthIndex: month });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return blocks;
};

/** Per-month total as whole hours (e.g. `186h`) — for activity/history heatmaps. */
export const heatmapHoursTotal = (days: DayData[]): string =>
  `${Math.round(days.reduce((sum, d) => sum + d.timeSpent, 0) / 3_600_000)}h`;

/** Per-month total as an occurrence count (e.g. `6×`) — for projection previews;
 *  empty when the month has none. */
export const heatmapOccurrenceTotal = (days: DayData[]): string => {
  const n = days.filter((d) => d.isProjected || d.isCompleted).length;
  return n ? `${n}×` : '';
};
