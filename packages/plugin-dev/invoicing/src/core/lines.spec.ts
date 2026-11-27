import { buildDraftLines, msToHours, sumBilled, toBilledMs, TaskLike } from './lines';
import { Invoice } from './types';

const H = 3_600_000;
const MIN = 60_000;

const task = (overrides: Partial<TaskLike>): TaskLike => ({
  id: 't1',
  title: 'Task',
  projectId: 'p1',
  parentId: null,
  timeSpentOnDay: {},
  ...overrides,
});

const opts = {
  projectId: 'p1',
  period: { from: '2026-10-01', to: '2026-10-31' },
  billed: {},
  rate: 80,
  roundingMin: 0,
};

describe('msToHours', () => {
  it('rounds to two decimals without a rounding step', () => {
    expect(msToHours(H + 20 * MIN, 0)).toBe(1.33);
  });

  it('rounds up to the step', () => {
    expect(msToHours(H + 1 * MIN, 15)).toBe(1.25);
    expect(msToHours(H + 15 * MIN, 15)).toBe(1.25);
    expect(msToHours(7 * MIN, 6)).toBe(0.2);
  });
});

describe('buildDraftLines', () => {
  it('sums the time inside the period per top-level task', () => {
    const tasks = [
      task({
        id: 'a',
        title: 'Design',
        timeSpentOnDay: { '2026-09-30': H, '2026-10-02': H, '2026-10-31': H / 2 },
      }),
    ];
    const [line] = buildDraftLines(tasks, opts);
    expect(line.hours).toBe(1.5);
    expect(line.rate).toBe(80);
    expect(line.openMs).toEqual({ '2026-10-02': H, '2026-10-31': H / 2 });
  });

  it('skips sub-tasks (their time is in the parent), other projects and idle tasks', () => {
    const tasks = [
      task({ id: 'parent', timeSpentOnDay: { '2026-10-05': 2 * H } }),
      task({ id: 'sub', parentId: 'parent', timeSpentOnDay: { '2026-10-05': 2 * H } }),
      task({ id: 'other', projectId: 'p2', timeSpentOnDay: { '2026-10-05': H } }),
      task({ id: 'idle', timeSpentOnDay: {} }),
    ];
    const lines = buildDraftLines(tasks, opts);
    expect(lines.map((l) => [l.taskId, l.hours])).toEqual([['parent', 2]]);
  });

  it('leaves out time an earlier invoice already billed, but keeps time added later', () => {
    const tasks = [
      task({ id: 'a', timeSpentOnDay: { '2026-10-02': 3 * H, '2026-10-03': H } }),
    ];
    const billed = { a: { '2026-10-02': 2 * H, '2026-10-03': H } };
    const [line] = buildDraftLines(tasks, { ...opts, billed });
    expect(line.hours).toBe(1);
    expect(line.openMs).toEqual({ '2026-10-02': H });
  });

  it('hides a line whose time rounds to 0.00 h, unless rounding lifts it', () => {
    const tasks = [task({ id: 'blip', timeSpentOnDay: { '2026-10-02': 10_000 } })];
    expect(buildDraftLines(tasks, opts)).toEqual([]);
    expect(buildDraftLines(tasks, { ...opts, roundingMin: 6 })[0].hours).toBe(0.1);
  });

  it('orders lines by the first day worked', () => {
    const tasks = [
      task({ id: 'late', timeSpentOnDay: { '2026-10-20': H } }),
      task({ id: 'early', timeSpentOnDay: { '2026-10-03': H } }),
    ];
    expect(buildDraftLines(tasks, opts).map((l) => l.taskId)).toEqual(['early', 'late']);
  });
});

describe('sumBilled / toBilledMs', () => {
  it('adds up billed time across invoices', () => {
    const inv = (billedMs: Invoice['billedMs']): Invoice => ({ billedMs }) as Invoice;
    expect(
      sumBilled([inv({ a: { '2026-10-02': H } }), inv({ a: { '2026-10-02': H / 2 } })]),
    ).toEqual({ a: { '2026-10-02': 1.5 * H } });
  });

  it('records the open time of each line', () => {
    const tasks = [task({ id: 'a', timeSpentOnDay: { '2026-10-02': H } })];
    expect(toBilledMs(buildDraftLines(tasks, opts))).toEqual({ a: { '2026-10-02': H } });
  });
});
