import { buildComparator, rewriteTagIdsForPanel, sanitizePanelCfg } from './boards.util';
import { BoardPanelCfg } from './boards.model';
import { TaskCopy } from '../tasks/task.model';

const basePanel: BoardPanelCfg = {
  id: 'p1',
  title: 'Panel',
  taskIds: [],
  includedTagIds: [],
  excludedTagIds: [],
  taskDoneState: 1,
  scheduledState: 1,
  isParentTasksOnly: false,
} as BoardPanelCfg;

describe('sanitizePanelCfg', () => {
  it('migrates sortByDue=asc to sortBy=dueDate/asc and drops sortByDue', () => {
    const out = sanitizePanelCfg({ ...basePanel, sortByDue: 'asc' });
    expect(out.sortBy).toBe('dueDate');
    expect(out.sortDir).toBe('asc');
    expect('sortByDue' in out).toBe(false);
  });

  it('migrates sortByDue=desc to sortBy=dueDate/desc', () => {
    const out = sanitizePanelCfg({ ...basePanel, sortByDue: 'desc' });
    expect(out.sortBy).toBe('dueDate');
    expect(out.sortDir).toBe('desc');
    expect('sortByDue' in out).toBe(false);
  });

  it('drops sortByDue=off without adding sortBy', () => {
    const out = sanitizePanelCfg({ ...basePanel, sortByDue: 'off' });
    expect(out.sortBy).toBeUndefined();
    expect(out.sortDir).toBeUndefined();
    expect('sortByDue' in out).toBe(false);
  });

  it('coerces null sortBy/sortDir/match-mode fields to absent', () => {
    const out = sanitizePanelCfg({
      ...basePanel,
      sortBy: null as any,
      sortDir: null as any,
      includedTagsMatch: null as any,
      excludedTagsMatch: null as any,
    });
    expect('sortBy' in out).toBe(false);
    expect('sortDir' in out).toBe(false);
    expect('includedTagsMatch' in out).toBe(false);
    expect('excludedTagsMatch' in out).toBe(false);
  });

  it('drops unknown sortBy values (e.g. from a newer client)', () => {
    const out = sanitizePanelCfg({
      ...basePanel,
      sortBy: 'priority' as any,
      sortDir: 'asc',
    });
    expect('sortBy' in out).toBe(false);
    // sortDir stays — it's valid on its own; it'll just go unused.
    expect(out.sortDir).toBe('asc');
  });

  it('preserves valid sortBy/sortDir', () => {
    const out = sanitizePanelCfg({
      ...basePanel,
      sortBy: 'title',
      sortDir: 'desc',
      includedTagsMatch: 'any',
      excludedTagsMatch: 'all',
    });
    expect(out.sortBy).toBe('title');
    expect(out.sortDir).toBe('desc');
    expect(out.includedTagsMatch).toBe('any');
    expect(out.excludedTagsMatch).toBe('all');
  });

  it('is idempotent', () => {
    const once = sanitizePanelCfg({ ...basePanel, sortByDue: 'asc' });
    const twice = sanitizePanelCfg(once);
    expect(twice).toEqual(once);
  });
});

describe('buildComparator', () => {
  const mk = (partial: Partial<TaskCopy>): TaskCopy =>
    ({ id: '', title: '', created: 0, timeEstimate: 0, ...partial }) as TaskCopy;

  describe('title', () => {
    it('sorts asc by title', () => {
      const cmp = buildComparator('title');
      const items = [mk({ title: 'b' }), mk({ title: 'a' }), mk({ title: 'c' })];
      items.sort(cmp);
      expect(items.map((t) => t.title)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('created', () => {
    it('sorts asc by created timestamp', () => {
      const cmp = buildComparator('created');
      const items = [mk({ created: 300 }), mk({ created: 100 }), mk({ created: 200 })];
      items.sort(cmp);
      expect(items.map((t) => t.created)).toEqual([100, 200, 300]);
    });
  });

  describe('timeEstimate', () => {
    it('treats missing timeEstimate as 0', () => {
      const cmp = buildComparator('timeEstimate');
      const items = [
        mk({ timeEstimate: 500 }),
        mk({ timeEstimate: undefined }),
        mk({ timeEstimate: 100 }),
      ];
      items.sort(cmp);
      expect(items.map((t) => t.timeEstimate ?? 0)).toEqual([0, 100, 500]);
    });
  });

  describe('dueDate', () => {
    it('orders tasks with only dueDay lexicographically', () => {
      const cmp = buildComparator('dueDate');
      const items = [
        mk({ id: 'c', dueDay: '2026-03-03' }),
        mk({ id: 'a', dueDay: '2026-01-01' }),
        mk({ id: 'b', dueDay: '2026-02-02' }),
      ];
      items.sort(cmp);
      expect(items.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    });

    it('orders tasks with only dueWithTime by timestamp', () => {
      const cmp = buildComparator('dueDate');
      const items = [
        mk({ id: 'c', dueWithTime: 3000 }),
        mk({ id: 'a', dueWithTime: 1000 }),
        mk({ id: 'b', dueWithTime: 2000 }),
      ];
      items.sort(cmp);
      expect(items.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    });

    it('sorts undated tasks after dated ones in asc', () => {
      const cmp = buildComparator('dueDate');
      const items = [
        mk({ id: 'none' }),
        mk({ id: 'early', dueDay: '2026-01-01' }),
        mk({ id: 'late', dueDay: '2026-06-01' }),
      ];
      items.sort(cmp);
      expect(items.map((t) => t.id)).toEqual(['early', 'late', 'none']);
    });

    it('mixes dueDay and dueWithTime correctly when they fall on the same day', () => {
      const cmp = buildComparator('dueDate');
      const sameDay = new Date('2026-01-15T14:00:00Z').getTime();
      const items = [
        mk({ id: 'ts', dueWithTime: sameDay }),
        mk({ id: 'day', dueDay: '2026-01-14' }),
      ];
      items.sort(cmp);
      // day 2026-01-14 < timestamp on 2026-01-15 regardless of TZ conversion
      expect(items[0].id).toBe('day');
      expect(items[1].id).toBe('ts');
    });
  });
});

describe('rewriteTagIdsForPanel', () => {
  type PanelFilter = Pick<
    BoardPanelCfg,
    'includedTagIds' | 'includedTagsMatch' | 'excludedTagIds' | 'excludedTagsMatch'
  >;

  const mkPanel = (overrides: Partial<PanelFilter> = {}): PanelFilter => ({
    includedTagIds: [],
    excludedTagIds: [],
    ...overrides,
  });

  it('returns the same tags when no include/exclude filters are set', () => {
    // Arrange
    const tags = ['a', 'b'];
    const panel = mkPanel();

    // Act
    const out = rewriteTagIdsForPanel(tags, panel);

    // Assert
    expect(out).toEqual(['a', 'b']);
  });

  it('"any" include mode: appends the first required tag when task has none', () => {
    // Arrange
    const tags = ['other'];
    const panel = mkPanel({
      includedTagIds: ['need1', 'need2'],
      includedTagsMatch: 'any',
    });

    // Act
    const out = rewriteTagIdsForPanel(tags, panel);

    // Assert — follow actual implementation: concat appends at the end
    expect(out).toEqual(['other', 'need1']);
  });

  it('"any" include mode: leaves tags unchanged when task already has one included', () => {
    // Arrange
    const tags = ['need2', 'keep'];
    const panel = mkPanel({
      includedTagIds: ['need1', 'need2'],
      includedTagsMatch: 'any',
    });

    // Act
    const out = rewriteTagIdsForPanel(tags, panel);

    // Assert
    expect(out).toEqual(['need2', 'keep']);
  });

  it('default ("any") exclude mode: strips ALL excluded tags present', () => {
    // Arrange
    const tags = ['x', 'keep', 'y'];
    const panel = mkPanel({ excludedTagIds: ['x', 'y'] });

    // Act
    const out = rewriteTagIdsForPanel(tags, panel);

    // Assert
    expect(out).toEqual(['keep']);
  });

  it('"all" exclude mode: strips only the FIRST excluded tag when task has every excluded', () => {
    // Arrange
    const tags = ['x', 'y', 'keep'];
    const panel = mkPanel({
      excludedTagIds: ['x', 'y'],
      excludedTagsMatch: 'all',
    });

    // Act
    const out = rewriteTagIdsForPanel(tags, panel);

    // Assert — only first excluded ('x') is dropped; 'y' stays
    expect(out).toEqual(['y', 'keep']);
  });

  it('"all" exclude mode: leaves tags unchanged when task is missing one excluded', () => {
    // Arrange — task only has 'x' so AND-exclude condition isn't met
    const tags = ['x', 'keep'];
    const panel = mkPanel({
      excludedTagIds: ['x', 'y'],
      excludedTagsMatch: 'all',
    });

    // Act
    const out = rewriteTagIdsForPanel(tags, panel);

    // Assert
    expect(out).toEqual(['x', 'keep']);
  });

  it('combines include-add and exclude-strip in a single call', () => {
    // Arrange — task has one excluded tag AND is missing the required include
    const tags = ['drop', 'keep'];
    const panel = mkPanel({
      includedTagIds: ['need'],
      includedTagsMatch: 'any',
      excludedTagIds: ['drop'],
    });

    // Act
    const out = rewriteTagIdsForPanel(tags, panel);

    // Assert — 'drop' stripped (default 'any' exclude), 'need' appended
    expect(out).toEqual(['keep', 'need']);
  });

  it('does not mutate the input tag array', () => {
    // Arrange
    const tags: readonly string[] = Object.freeze(['x', 'y']);
    const panel = mkPanel({ excludedTagIds: ['x'] });

    // Act + Assert — would throw if mutated
    expect(() => rewriteTagIdsForPanel(tags, panel)).not.toThrow();
    expect(tags).toEqual(['x', 'y']);
  });
});
