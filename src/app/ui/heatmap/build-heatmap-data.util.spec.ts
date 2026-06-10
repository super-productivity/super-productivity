import {
  buildHeatmapMonths,
  buildHeatmapWeeks,
  buildProjectionDayMap,
  heatmapHoursTotal,
  heatmapOccurrenceTotal,
} from './build-heatmap-data.util';
import { DayData } from './heatmap.component';

const D = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

describe('buildProjectionDayMap', () => {
  it('marks only occurrence days as projected (level 1) over the inclusive range', () => {
    const map = buildProjectionDayMap(
      [D('2024-06-03'), D('2024-06-10')],
      D('2024-06-01'),
      D('2024-06-12'),
    );
    expect(map.size).toBe(12); // inclusive both ends
    expect(map.get('2024-06-03')!.isProjected).toBe(true);
    expect(map.get('2024-06-03')!.level).toBe(1);
    expect(map.get('2024-06-10')!.isProjected).toBe(true);
    expect(map.get('2024-06-04')!.isProjected).toBe(false);
    expect(map.get('2024-06-04')!.level).toBe(0);
  });

  it('ignores occurrences outside the range', () => {
    const map = buildProjectionDayMap(
      [D('2024-05-01')],
      D('2024-06-01'),
      D('2024-06-03'),
    );
    expect([...map.values()].every((d) => !d.isProjected)).toBe(true);
  });
});

describe('buildHeatmapWeeks', () => {
  it('lays days into 7-day weeks and emits month labels', () => {
    const map = buildProjectionDayMap([], D('2024-06-01'), D('2024-06-30'));
    const grid = buildHeatmapWeeks(map, D('2024-06-01'), D('2024-06-30'), 0, MONTHS);
    expect(grid.weeks.length).toBeGreaterThan(0);
    grid.weeks.forEach((w) => expect(w.days.length).toBe(7));
    expect(grid.monthLabels).toContain('Jun');
  });

  it('pads cells outside the range with null', () => {
    // Jun 1 2024 is a Saturday; week-start Sunday → leading nulls before it.
    const map = buildProjectionDayMap([], D('2024-06-01'), D('2024-06-01'));
    const grid = buildHeatmapWeeks(map, D('2024-06-01'), D('2024-06-01'), 0, MONTHS);
    const nonNull = grid.weeks.flatMap((w) => w.days).filter((d) => d !== null);
    expect(nonNull.length).toBe(1);
    expect(nonNull[0]!.dateStr).toBe('2024-06-01');
  });
});

describe('buildHeatmapMonths', () => {
  it('groups days into one block per month, each a 7-row column grid', () => {
    const map = buildProjectionDayMap(
      [D('2024-01-15'), D('2024-02-10')],
      D('2024-01-01'),
      D('2024-02-29'),
    );
    const blocks = buildHeatmapMonths(
      map,
      D('2024-01-01'),
      D('2024-02-29'),
      0,
      MONTHS,
      heatmapOccurrenceTotal,
    );
    expect(blocks.map((b) => b.label)).toEqual(['Jan 2024', 'Feb']);
    blocks.forEach((b) => b.weeks.forEach((w) => expect(w.days.length).toBe(7)));
    // one projected occurrence in each month
    expect(blocks[0].total).toBe('1×');
    expect(blocks[1].total).toBe('1×');
  });

  it('year-stamps the first block of each year so a rolling window spanning the same month twice stays unambiguous', () => {
    const map = buildProjectionDayMap([], D('2024-06-15'), D('2025-06-15'));
    const blocks = buildHeatmapMonths(
      map,
      D('2024-06-15'),
      D('2025-06-15'),
      0,
      MONTHS,
      heatmapOccurrenceTotal,
    );
    const labels = blocks.map((b) => b.label);
    // 13 partial months: Jun 2024 … Jun 2025 — the two Junes must differ.
    expect(labels.length).toBe(13);
    expect(labels[0]).toBe('Jun 2024');
    expect(labels[7]).toBe('Jan 2025');
    expect(labels[12]).toBe('Jun');
    expect(labels[0]).not.toBe(labels[12]);
    // Non-boundary months stay plain.
    expect(labels[1]).toBe('Jul');
  });

  it('keeps CURRENT-year labels plain — only other years get stamped', () => {
    // "Jun" not "Jun 2026": the current year is the implied default; the next
    // year's stamp marks the boundary in a rolling window.
    const y = new Date().getFullYear();
    const from = D(`${y}-06-15`);
    const to = D(`${y + 1}-06-15`);
    const map = buildProjectionDayMap([], from, to);
    const labels = buildHeatmapMonths(
      map,
      from,
      to,
      0,
      MONTHS,
      heatmapOccurrenceTotal,
    ).map((b) => b.label);
    expect(labels[0]).toBe('Jun');
    expect(labels[7]).toBe(`Jan ${y + 1}`);
    expect(labels[12]).toBe('Jun');
    const sameYear = buildHeatmapMonths(
      buildProjectionDayMap([], D(`${y}-01-01`), D(`${y}-02-28`)),
      D(`${y}-01-01`),
      D(`${y}-02-28`),
      0,
      MONTHS,
      heatmapOccurrenceTotal,
    ).map((b) => b.label);
    expect(sameYear).toEqual(['Jan', 'Feb']);
  });

  it('heatmapHoursTotal sums day time as whole hours', () => {
    const days = [{ timeSpent: 7_200_000 }, { timeSpent: 3_600_000 }] as DayData[];
    expect(heatmapHoursTotal(days)).toBe('3h');
    expect(heatmapHoursTotal([])).toBe('0h');
  });

  it('heatmapOccurrenceTotal is empty when a month has no occurrences', () => {
    expect(heatmapOccurrenceTotal([])).toBe('');
  });
});
