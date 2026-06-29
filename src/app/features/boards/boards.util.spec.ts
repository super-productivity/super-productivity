import {
  buildComparator,
  doesTaskMatchPanel,
  rewriteTagIdsForPanel,
  sanitizePanelCfg,
} from './boards.util';
import {
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from './boards.model';
import { TaskCopy } from '../tasks/task.model';

const basePanel: any = {
  id: 'p1',
  title: 'Panel',
  taskIds: [],
  includedTagIds: [],
  excludedTagIds: [],
  taskDoneState: 1,
  scheduledState: 1,
  isParentTasksOnly: false,
  projectIds: [''],
};

describe('sanitizePanelCfg', () => {
  it('migrates legacy projectId to projectIds array', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { projectIds, ...inputWithoutProjectIds } = basePanel;
    const out = sanitizePanelCfg({ ...inputWithoutProjectIds, projectId: 'p1' } as any);
    expect(out.projectIds).toEqual(['p1']);
    expect('projectId' in out).toBe(false);
  });

  it('migrates legacy empty projectId to projectIds [""]', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { projectIds, ...inputWithoutProjectIds } = basePanel;
    const out = sanitizePanelCfg({ ...inputWithoutProjectIds, projectId: '' } as any);
    expect(out.projectIds).toEqual(['']);
    expect('projectId' in out).toBe(false);
  });

  it('ensures projectIds is always an array', () => {
    const out = sanitizePanelCfg({ ...basePanel, projectIds: null as any } as any);
    expect(out.projectIds).toEqual(['']);
  });

  it('migrates legacy projectId even if projectIds is already defaulted to [""]', () => {
    const out = sanitizePanelCfg({
      ...basePanel,
      projectIds: [''],
      projectId: 'p1',
    } as any);
    expect(out.projectIds).toEqual(['p1']);
    expect('projectId' in out).toBe(false);
  });

  it('deliberately drops specific IDs when "" co-occurs (lossy canonicalization)', () => {
    const out = sanitizePanelCfg({ ...basePanel, projectIds: ['', 'p1', 'p2'] } as any);
    expect(out.projectIds).toEqual(['']);
  });

  it('migrates sortByDue=asc to sortBy=dueDate/asc and drops sortByDue', () => {
    const out = sanitizePanelCfg({ ...basePanel, sortByDue: 'asc' } as any);
    expect(out.sortBy).toBe('dueDate');
    expect(out.sortDir).toBe('asc');
    expect('sortByDue' in out).toBe(false);
  });

  it('migrates sortByDue=desc to sortBy=dueDate/desc', () => {
    const out = sanitizePanelCfg({ ...basePanel, sortByDue: 'desc' } as any);
    expect(out.sortBy).toBe('dueDate');
    expect(out.sortDir).toBe('desc');
    expect('sortByDue' in out).toBe(false);
  });

  it('drops sortByDue=off without adding sortBy', () => {
    const out = sanitizePanelCfg({ ...basePanel, sortByDue: 'off' } as any);
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
    } as any);
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
    } as any);
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
    } as any);
    expect(out.sortBy).toBe('title');
    expect(out.sortDir).toBe('desc');
    expect(out.includedTagsMatch).toBe('any');
    expect(out.excludedTagsMatch).toBe('all');
  });

  it('is idempotent', () => {
    const once = sanitizePanelCfg({ ...basePanel, sortByDue: 'asc' } as any);
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

describe('doesTaskMatchPanel', () => {
  const mkPanel = (overrides: Partial<BoardPanelCfg> = {}): BoardPanelCfg =>
    ({ ...basePanel, ...overrides }) as BoardPanelCfg;

  const mkTask = (partial: Partial<TaskCopy> = {}): TaskCopy =>
    ({ id: 't', title: '', tagIds: [], projectId: 'INBOX', ...partial }) as TaskCopy;

  // Most criteria don't involve backlog; default the (required) predicate to
  // "nothing is in backlog" so those cases stay terse.
  const noBacklog = (): boolean => false;
  const match = (
    task: TaskCopy,
    panel: BoardPanelCfg,
    isInBacklog: (t: Readonly<TaskCopy>) => boolean = noBacklog,
  ): boolean => doesTaskMatchPanel(task, panel, isInBacklog);

  it('matches any task when no criteria are set', () => {
    expect(match(mkTask(), mkPanel())).toBe(true);
  });

  describe('included tags', () => {
    it('default ("all"): requires every included tag', () => {
      const panel = mkPanel({ includedTagIds: ['a', 'b'] });
      expect(match(mkTask({ tagIds: ['a', 'b', 'c'] }), panel)).toBe(true);
      expect(match(mkTask({ tagIds: ['a'] }), panel)).toBe(false);
    });

    it('"any": requires at least one included tag', () => {
      const panel = mkPanel({ includedTagIds: ['a', 'b'], includedTagsMatch: 'any' });
      expect(match(mkTask({ tagIds: ['b'] }), panel)).toBe(true);
      expect(match(mkTask({ tagIds: ['x'] }), panel)).toBe(false);
    });
  });

  describe('excluded tags', () => {
    it('default ("any"): excludes when any excluded tag is present', () => {
      const panel = mkPanel({ excludedTagIds: ['a', 'b'] });
      expect(match(mkTask({ tagIds: ['a'] }), panel)).toBe(false);
      expect(match(mkTask({ tagIds: ['x'] }), panel)).toBe(true);
    });

    it('"all": excludes only when every excluded tag is present', () => {
      const panel = mkPanel({ excludedTagIds: ['a', 'b'], excludedTagsMatch: 'all' });
      expect(match(mkTask({ tagIds: ['a', 'b'] }), panel)).toBe(false);
      expect(match(mkTask({ tagIds: ['a'] }), panel)).toBe(true);
    });
  });

  it('isParentTasksOnly: excludes sub-tasks', () => {
    const panel = mkPanel({ isParentTasksOnly: true });
    expect(match(mkTask({ parentId: undefined }), panel)).toBe(true);
    expect(match(mkTask({ parentId: 'parent' }), panel)).toBe(false);
  });

  describe('taskDoneState', () => {
    it('Done: requires isDone', () => {
      const panel = mkPanel({ taskDoneState: BoardPanelCfgTaskDoneState.Done });
      expect(match(mkTask({ isDone: true }), panel)).toBe(true);
      expect(match(mkTask({ isDone: false }), panel)).toBe(false);
    });

    it('UnDone: requires not isDone', () => {
      const panel = mkPanel({ taskDoneState: BoardPanelCfgTaskDoneState.UnDone });
      expect(match(mkTask({ isDone: false }), panel)).toBe(true);
      expect(match(mkTask({ isDone: true }), panel)).toBe(false);
    });
  });

  describe('projectIds', () => {
    it('All Projects ([""]): matches any project', () => {
      const panel = mkPanel({ projectIds: [''] });
      expect(match(mkTask({ projectId: 'p1' }), panel)).toBe(true);
    });

    it('specific: matches only the listed projects', () => {
      const panel = mkPanel({ projectIds: ['p1'] });
      expect(match(mkTask({ projectId: 'p1' }), panel)).toBe(true);
      expect(match(mkTask({ projectId: 'p2' }), panel)).toBe(false);
    });
  });

  describe('scheduledState', () => {
    it('Scheduled: requires a due date', () => {
      const panel = mkPanel({ scheduledState: BoardPanelCfgScheduledState.Scheduled });
      expect(match(mkTask({ dueDay: '2026-01-01' }), panel)).toBe(true);
      expect(match(mkTask(), panel)).toBe(false);
    });

    it('NotScheduled: requires no due date', () => {
      const panel = mkPanel({ scheduledState: BoardPanelCfgScheduledState.NotScheduled });
      expect(match(mkTask(), panel)).toBe(true);
      expect(match(mkTask({ dueWithTime: 123 }), panel)).toBe(false);
    });
  });

  describe('backlogState', () => {
    const isInBacklog = (t: Readonly<TaskCopy>): boolean => t.id === 'backlogged';

    it('OnlyBacklog: keeps only backlog tasks', () => {
      const panel = mkPanel({ backlogState: BoardPanelCfgTaskTypeFilter.OnlyBacklog });
      expect(match(mkTask({ id: 'backlogged' }), panel, isInBacklog)).toBe(true);
      expect(match(mkTask({ id: 'regular' }), panel, isInBacklog)).toBe(false);
    });

    it('NoBacklog: drops backlog tasks', () => {
      const panel = mkPanel({ backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog });
      expect(match(mkTask({ id: 'regular' }), panel, isInBacklog)).toBe(true);
      expect(match(mkTask({ id: 'backlogged' }), panel, isInBacklog)).toBe(false);
    });
  });

  it('combines multiple criteria (AND across dimensions)', () => {
    const panel = mkPanel({
      includedTagIds: ['a'],
      excludedTagIds: ['x'],
      taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
      projectIds: ['p1'],
    });
    expect(match(mkTask({ tagIds: ['a'], isDone: false, projectId: 'p1' }), panel)).toBe(
      true,
    );
    // fails the exclude dimension only
    expect(
      match(mkTask({ tagIds: ['a', 'x'], isDone: false, projectId: 'p1' }), panel),
    ).toBe(false);
  });

  it('ANDs every dimension, including scheduled + backlog', () => {
    const inBacklog = (t: Readonly<TaskCopy>): boolean => t.id === 'b';
    const panel = mkPanel({
      includedTagIds: ['a'],
      excludedTagIds: ['x'],
      taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
      projectIds: ['p1'],
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      backlogState: BoardPanelCfgTaskTypeFilter.OnlyBacklog,
    });
    const matching = mkTask({
      id: 'b',
      tagIds: ['a'],
      isDone: false,
      projectId: 'p1',
      dueDay: '2026-01-01',
    });
    expect(doesTaskMatchPanel(matching, panel, inBacklog)).toBe(true);
    // identical except it fails ONLY the backlog dimension
    expect(doesTaskMatchPanel({ ...matching, id: 'not-b' }, panel, inBacklog)).toBe(
      false,
    );
  });
});
