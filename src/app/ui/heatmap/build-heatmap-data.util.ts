import { DayData, HeatmapData, WeekData } from './heatmap.component';
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
