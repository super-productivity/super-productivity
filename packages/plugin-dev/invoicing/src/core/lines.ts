import { InvoiceLine, Invoice, MsByTaskDay, Period } from './types';

/** The task fields the draft needs; matches the plugin API `Task`. */
export interface TaskLike {
  id: string;
  title: string;
  projectId: string | null;
  parentId?: string | null;
  timeSpentOnDay?: Record<string, number>;
}

export interface DraftLine extends InvoiceLine {
  taskId: string;
  firstDay: string;
  /** Unbilled ms per day that issuing this line marks as billed. */
  openMs: Record<string, number>;
}

const MS_PER_HOUR = 3_600_000;

/** Sums the billed time of all issued invoices per task and day. */
export const sumBilled = (invoices: Invoice[]): MsByTaskDay => {
  const total: MsByTaskDay = {};
  for (const invoice of invoices) {
    for (const [taskId, days] of Object.entries(invoice.billedMs)) {
      const target = (total[taskId] ??= {});
      for (const [day, ms] of Object.entries(days)) {
        target[day] = (target[day] ?? 0) + ms;
      }
    }
  }
  return total;
};

/** Hours to two decimals, rounded up to `roundingMin` minutes when set. */
export const msToHours = (ms: number, roundingMin: number): number => {
  const step = roundingMin * 60_000;
  const rounded = step > 0 ? Math.ceil(ms / step) * step : ms;
  return Math.round((rounded / MS_PER_HOUR) * 100) / 100;
};

const openMsInPeriod = (
  task: TaskLike,
  period: Period,
  billed: MsByTaskDay,
): Record<string, number> => {
  const open: Record<string, number> = {};
  for (const [day, ms] of Object.entries(task.timeSpentOnDay ?? {})) {
    if (day < period.from || day > period.to) continue;
    const rest = ms - (billed[task.id]?.[day] ?? 0);
    if (rest > 0) open[day] = rest;
  }
  return open;
};

export interface DraftOptions {
  projectId: string;
  period: Period;
  billed: MsByTaskDay;
  rate: number;
  roundingMin: number;
}

/**
 * One line per top-level task with unbilled time in the period.
 * Only top-level tasks count: a parent's time already includes its sub-tasks.
 */
export const buildDraftLines = (tasks: TaskLike[], opts: DraftOptions): DraftLine[] =>
  tasks
    .filter((task) => !task.parentId && task.projectId === opts.projectId)
    .map((task) => {
      const openMs = openMsInPeriod(task, opts.period, opts.billed);
      const days = Object.keys(openMs).sort();
      const ms = days.reduce((sum, day) => sum + openMs[day], 0);
      return {
        taskId: task.id,
        title: task.title,
        hours: msToHours(ms, opts.roundingMin),
        rate: opts.rate,
        firstDay: days[0] ?? '',
        openMs,
      };
    })
    // Also drops lines under 18 s, which would print as 0.00 h.
    .filter((line) => line.hours > 0)
    .sort((a, b) => a.firstDay.localeCompare(b.firstDay));

/** What an invoice records as billed: the unbilled time of its included lines. */
export const toBilledMs = (lines: DraftLine[]): MsByTaskDay =>
  Object.fromEntries(lines.map((line) => [line.taskId, { ...line.openMs }]));
