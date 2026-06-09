import { buildHeatmapWeeks, buildProjectionDayMap } from './build-heatmap-data.util';

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
