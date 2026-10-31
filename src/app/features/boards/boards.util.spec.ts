import {
  criteriaToPanelFields,
  getCalendarDateForDueDay,
  getViewIcon,
  normalizeBoardForSave,
  getPanelSortKey,
  panelToCriteria,
  sanitizePanelCfg,
  toEditorModel,
  withDueStateImpliesScheduled,
  withPanelSortKey,
} from './boards.util';
import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
  BoardSortField,
} from './boards.model';
import { TaskCopy } from '../tasks/task.model';
import { TODAY_TAG } from '../tag/tag.const';
import {
  addDaysToDbDateStr,
  buildTaskComparator,
  createTaskCriteriaCtx,
  getChangesToMatch,
  getTagIdsToMatch,
  matchesTaskCriteria,
} from '../tasks/task-criteria/task-criteria';
import { TaskCriteriaCtx } from '../tasks/task-criteria/task-criteria.model';
import { UNTOUCHED_SAVE_FIXTURES } from './testing/view-editor-fixtures';

// The board panel filters run through the shared task-criteria module; these
// helpers keep this panel-shaped matrix as a parity test of `panelToCriteria`.
const doesTaskMatchPanel = (
  task: TaskCopy,
  panel: BoardPanelCfg,
  isInBacklog: (task: Readonly<TaskCopy>) => boolean,
  ctx: TaskCriteriaCtx,
): boolean => matchesTaskCriteria(task, panelToCriteria(panel), { ...ctx, isInBacklog });
const rewriteTagIdsForPanel = getTagIdsToMatch;
const SORT_BY_KEY = {
  dueDate: 'plannedDate',
  created: 'created',
  title: 'title',
  timeEstimate: 'estimate',
} as const;
const buildComparator = (field: BoardSortField): ((a: TaskCopy, b: TaskCopy) => number) =>
  buildTaskComparator(SORT_BY_KEY[field], {
    collator: new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }),
  });
const createBoardDueCtx = (
  todayStr: string,
  startOfNextDayDiffMs: number,
): TaskCriteriaCtx =>
  createTaskCriteriaCtx({ todayStr, startOfNextDayDiffMs, firstDayOfWeek: 1 });

// Only consulted by panels with a due rule.
const DUE_CTX = createBoardDueCtx('2026-10-30', 0);

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

  it('drops a null or empty dueState (Formly writes null for "Any")', () => {
    expect('dueState' in sanitizePanelCfg({ ...basePanel, dueState: null } as any)).toBe(
      false,
    );
    expect('dueState' in sanitizePanelCfg({ ...basePanel, dueState: '' } as any)).toBe(
      false,
    );
  });

  it('keeps known and unknown dueState strings', () => {
    expect(sanitizePanelCfg({ ...basePanel, dueState: 'today' }).dueState).toBe('today');
    // A newer client's value must survive this client's next updateBoard.
    expect(sanitizePanelCfg({ ...basePanel, dueState: 'nextMonth' }).dueState).toBe(
      'nextMonth',
    );
  });

  it('keeps panel keys it does not know (written by a newer client)', () => {
    const out = sanitizePanelCfg({ ...basePanel, someFutureRule: 'x' } as any);
    expect((out as any).someFutureRule).toBe('x');
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

  // TODAY_TAG is virtual: membership derives from dueDay/dueWithTime and it must
  // never land in task.tagIds (ARCHITECTURE-DECISIONS #2). The rewrite therefore
  // has to agree with `doesTaskMatchPanel`, which can only ever see real tags.
  describe('TODAY_TAG (virtual)', () => {
    it('"all" include mode: appends the real required tags but never TODAY_TAG', () => {
      // Arrange
      const tags = ['keep'];
      const panel = mkPanel({ includedTagIds: [TODAY_TAG.id, 'need'] });

      // Act
      const out = rewriteTagIdsForPanel(tags, panel);

      // Assert
      expect(out).toEqual(['keep', 'need']);
    });

    it('"any" include mode: appends the first REAL required tag, not TODAY_TAG', () => {
      // Arrange
      const tags = ['keep'];
      const panel = mkPanel({
        includedTagIds: [TODAY_TAG.id, 'need'],
        includedTagsMatch: 'any',
      });

      // Act
      const out = rewriteTagIdsForPanel(tags, panel);

      // Assert
      expect(out).toEqual(['keep', 'need']);
    });

    it('include mode: adds nothing when TODAY_TAG is the only required tag', () => {
      // Arrange
      const tags = ['keep'];
      const panel = mkPanel({ includedTagIds: [TODAY_TAG.id] });

      // Act
      const out = rewriteTagIdsForPanel(tags, panel);

      // Assert
      expect(out).toEqual(['keep']);
    });

    it('"all" exclude mode: keeps every real tag, because the AND-exclude can never fire', () => {
      // Arrange — `doesTaskMatchPanel` needs ALL of TODAY/x/y present to exclude,
      // and TODAY can never be present, so nothing may be stripped here either.
      const tags = ['x', 'y', 'keep'];
      const panel = mkPanel({
        excludedTagIds: [TODAY_TAG.id, 'x', 'y'],
        excludedTagsMatch: 'all',
      });

      // Act
      const out = rewriteTagIdsForPanel(tags, panel);

      // Assert — rewrite agrees with the predicate: no change
      expect(out).toEqual(['x', 'y', 'keep']);
      expect(
        doesTaskMatchPanel(
          { id: 't', title: '', projectId: 'INBOX', tagIds: out } as TaskCopy,
          { ...basePanel, ...panel } as BoardPanelCfg,
          () => false,
          DUE_CTX,
        ),
      ).toBe(true);
    });

    it('strips a legacy TODAY_TAG carried in the task’s own tags', () => {
      // Arrange — corrupt data written by an older build
      const tags = [TODAY_TAG.id, 'keep'];
      const panel = mkPanel();

      // Act
      const out = rewriteTagIdsForPanel(tags, panel);

      // Assert
      expect(out).toEqual(['keep']);
    });
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
  ): boolean => doesTaskMatchPanel(task, panel, isInBacklog, DUE_CTX);

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
    expect(doesTaskMatchPanel(matching, panel, inBacklog, DUE_CTX)).toBe(true);
    // identical except it fails ONLY the backlog dimension
    expect(
      doesTaskMatchPanel({ ...matching, id: 'not-b' }, panel, inBacklog, DUE_CTX),
    ).toBe(false);
  });

  describe('dueState', () => {
    const HOUR = 60 * 60 * 1000;
    const at = (day: string, hours: number): number => {
      const d = new Date(`${day}T00:00:00`);
      d.setHours(hours);
      return d.getTime();
    };

    it('matches any due date when absent', () => {
      expect(match(mkTask(), mkPanel())).toBe(true);
    });

    it('treats an unknown value as absent', () => {
      expect(match(mkTask(), mkPanel({ dueState: 'nextFullMoon' }))).toBe(true);
    });

    it('never matches an undated task when set', () => {
      expect(match(mkTask(), mkPanel({ dueState: 'today' }))).toBe(false);
      expect(match(mkTask(), mkPanel({ dueState: 'overdue' }))).toBe(false);
    });

    it('today / tomorrow / next7Days compare the due day', () => {
      const today = mkPanel({ dueState: 'today' });
      const tomorrow = mkPanel({ dueState: 'tomorrow' });
      const week = mkPanel({ dueState: 'next7Days' });
      expect(match(mkTask({ dueDay: '2026-10-30' }), today)).toBe(true);
      expect(match(mkTask({ dueDay: '2026-10-31' }), today)).toBe(false);
      expect(match(mkTask({ dueDay: '2026-10-31' }), tomorrow)).toBe(true);
      expect(match(mkTask({ dueDay: '2026-10-30' }), week)).toBe(true);
      expect(match(mkTask({ dueDay: '2026-11-05' }), week)).toBe(true);
      expect(match(mkTask({ dueDay: '2026-11-06' }), week)).toBe(false);
      expect(match(mkTask({ dueDay: '2026-10-29' }), week)).toBe(false);
    });

    it('overdue uses the logical day boundary', () => {
      const overdue = mkPanel({ dueState: 'overdue' });
      expect(match(mkTask({ dueDay: '2026-10-29' }), overdue)).toBe(true);
      expect(match(mkTask({ dueDay: '2026-10-30' }), overdue)).toBe(false);
      expect(match(mkTask({ dueWithTime: at('2026-10-29', 23) }), overdue)).toBe(true);
      expect(match(mkTask({ dueWithTime: at('2026-10-30', 9) }), overdue)).toBe(false);
    });

    it('dueWithTime wins over dueDay', () => {
      const task = mkTask({ dueDay: '2026-10-31', dueWithTime: at('2026-10-30', 9) });
      expect(match(task, mkPanel({ dueState: 'today' }))).toBe(true);
      expect(match(task, mkPanel({ dueState: 'tomorrow' }))).toBe(false);
    });

    it('respects a custom start of day', () => {
      // Day starts at 04:00: 02:00 on Oct 31 still belongs to Oct 30.
      const ctx = createBoardDueCtx('2026-10-30', 4 * HOUR);
      const task = mkTask({ dueWithTime: at('2026-10-31', 2) });
      expect(
        doesTaskMatchPanel(task, mkPanel({ dueState: 'today' }), noBacklog, ctx),
      ).toBe(true);
      expect(
        doesTaskMatchPanel(task, mkPanel({ dueState: 'tomorrow' }), noBacklog, ctx),
      ).toBe(false);
    });
  });
});

describe('addDaysToDbDateStr', () => {
  it('adds calendar days across month ends and DST changes', () => {
    expect(addDaysToDbDateStr('2026-10-30', 1)).toBe('2026-10-31');
    expect(addDaysToDbDateStr('2026-10-30', 6)).toBe('2026-11-05');
    // Europe/Berlin and America/Los_Angeles both change clocks in this range.
    expect(addDaysToDbDateStr('2026-03-27', 6)).toBe('2026-04-02');
    expect(addDaysToDbDateStr('2026-10-24', 6)).toBe('2026-10-30');
  });
});

describe('due date write-back (getChangesToMatch on a panel)', () => {
  const panel = (dueState?: string): Pick<BoardPanelCfg, 'dueState'> => ({ dueState });
  // undefined: no date change; a day: schedule for it; null: refused.
  const getDueDayForPanel = (
    task: Partial<TaskCopy>,
    panelCfg: Pick<BoardPanelCfg, 'dueState'>,
    ctx: TaskCriteriaCtx,
  ): string | null | undefined => {
    const changes = getChangesToMatch(
      { tagIds: [], projectId: 'p', ...task } as TaskCopy,
      panelToCriteria({ ...basePanel, ...panelCfg }),
      ctx,
    );
    return changes === null ? null : changes.scheduleDay;
  };

  it('needs no change without a rule or when the task already matches', () => {
    expect(getDueDayForPanel({}, panel(), DUE_CTX)).toBeUndefined();
    expect(getDueDayForPanel({}, panel('unknown'), DUE_CTX)).toBeUndefined();
    expect(
      getDueDayForPanel({ dueDay: '2026-10-30' }, panel('today'), DUE_CTX),
    ).toBeUndefined();
    expect(
      getDueDayForPanel({ dueDay: '2026-11-02' }, panel('next7Days'), DUE_CTX),
    ).toBeUndefined();
    expect(
      getDueDayForPanel({ dueDay: '2026-10-01' }, panel('overdue'), DUE_CTX),
    ).toBeUndefined();
  });

  it('returns the day to schedule for', () => {
    expect(getDueDayForPanel({}, panel('today'), DUE_CTX)).toBe('2026-10-30');
    expect(getDueDayForPanel({ dueDay: '2026-10-30' }, panel('tomorrow'), DUE_CTX)).toBe(
      '2026-10-31',
    );
    expect(getDueDayForPanel({ dueDay: '2026-12-24' }, panel('next7Days'), DUE_CTX)).toBe(
      '2026-10-30',
    );
  });

  it('returns null when no date can satisfy the rule', () => {
    expect(getDueDayForPanel({}, panel('overdue'), DUE_CTX)).toBeNull();
    expect(
      getDueDayForPanel({ dueDay: '2026-10-30' }, panel('overdue'), DUE_CTX),
    ).toBeNull();
  });
});

describe('withDueStateImpliesScheduled', () => {
  const board = (panels: Partial<BoardPanelCfg>[]): BoardCfg => ({
    id: 'b',
    title: 'B',
    cols: 1,
    panels: panels.map((p) => ({ ...basePanel, ...p })),
  });

  it('marks panels with a due rule as scheduled', () => {
    const out = withDueStateImpliesScheduled(
      board([
        { dueState: 'today', scheduledState: BoardPanelCfgScheduledState.NotScheduled },
        { scheduledState: BoardPanelCfgScheduledState.NotScheduled },
      ]),
    );
    expect(out.panels[0].scheduledState).toBe(BoardPanelCfgScheduledState.Scheduled);
    expect(out.panels[1].scheduledState).toBe(BoardPanelCfgScheduledState.NotScheduled);
  });

  it('leaves panels with an unknown due rule alone', () => {
    const out = withDueStateImpliesScheduled(board([{ dueState: 'future' }]));
    expect(out.panels[0].scheduledState).toBe(BoardPanelCfgScheduledState.All);
  });
});

describe('getCalendarDateForDueDay', () => {
  const HOUR = 60 * 60 * 1000;
  const at = (day: string, hours: number): number =>
    new Date(`${day}T${String(hours).padStart(2, '0')}:00:00`).getTime();

  it('keeps the day for untimed tasks and without a day-start offset', () => {
    expect(getCalendarDateForDueDay({}, '2026-10-30', 4 * HOUR)).toBe('2026-10-30');
    expect(
      getCalendarDateForDueDay({ dueWithTime: at('2026-10-01', 1) }, '2026-10-30', 0),
    ).toBe('2026-10-30');
  });

  it('moves a time before the start of day to the next calendar date', () => {
    // 01:00 with a 04:00 day start belongs to the previous logical day.
    expect(
      getCalendarDateForDueDay(
        { dueWithTime: at('2026-10-01', 1) },
        '2026-10-30',
        4 * HOUR,
      ),
    ).toBe('2026-10-31');
    expect(
      getCalendarDateForDueDay(
        { dueWithTime: at('2026-10-01', 9) },
        '2026-10-30',
        4 * HOUR,
      ),
    ).toBe('2026-10-30');
  });
});

describe('panelToCriteria: rules added for views', () => {
  const panel = (overrides: Partial<BoardPanelCfg>): BoardPanelCfg =>
    ({ ...basePanel, ...overrides }) as BoardPanelCfg;

  it('maps every rule field, a planned-date rule replacing the scheduled state', () => {
    expect(
      panelToCriteria(
        panel({
          dueState: 'thisWeek',
          scheduledState: BoardPanelCfgScheduledState.NotScheduled,
          deadlineState: 'nextMonth',
          estimateRule: '1800000',
          timeSpentRule: 'none',
          priorityRule: '3',
          isUntagged: true,
          projectIds: ['p1'],
        }),
      ),
    ).toEqual(
      jasmine.objectContaining({
        plannedDate: 'thisWeek',
        deadline: 'nextMonth',
        estimate: 1800000,
        timeSpent: 'none',
        priority: 3,
        isUntagged: true,
        projectIds: ['p1'],
      }),
    );
    expect(panelToCriteria(panel({ dueState: 'today' })).scheduled).toBeUndefined();
  });

  it('reads an empty project list as all projects, like released clients', () => {
    expect(panelToCriteria(panel({ projectIds: [] })).projectIds).toBeUndefined();
    expect(panelToCriteria(panel({ projectIds: [''] })).projectIds).toBeUndefined();
  });

  it('ignores values it does not know (written by a newer client)', () => {
    const criteria = panelToCriteria(
      panel({
        dueState: 'nextYear',
        deadlineState: 'x',
        estimateRule: 'lots',
        priorityRule: '9',
      }),
    );
    expect(criteria.plannedDate).toBeUndefined();
    expect(criteria.deadline).toBeUndefined();
    expect(criteria.estimate).toBeUndefined();
    expect(criteria.priority).toBeUndefined();
  });
});

describe('panel sort keys', () => {
  const panel = (overrides: Partial<BoardPanelCfg>): BoardPanelCfg =>
    ({ ...basePanel, ...overrides }) as BoardPanelCfg;

  it('stores keys sortBy can hold in sortBy, others in sortKey', () => {
    expect(withPanelSortKey(panel({ sortKey: 'tag' }), 'title')).toEqual(
      jasmine.objectContaining({ sortBy: 'title' }),
    );
    expect('sortKey' in withPanelSortKey(panel({ sortKey: 'tag' }), 'title')).toBeFalse();
    const priority = withPanelSortKey(panel({ sortBy: 'title' }), 'priority');
    expect(priority.sortKey).toBe('priority');
    expect('sortBy' in priority).toBeFalse();
    const manual = withPanelSortKey(panel({ sortBy: 'title' }), null);
    expect('sortBy' in manual || 'sortKey' in manual).toBeFalse();
  });

  it('reads sortBy first, so a sort picked on a released client wins', () => {
    expect(getPanelSortKey({ sortBy: 'created', sortKey: 'priority' })).toBe('created');
    expect(getPanelSortKey({ sortKey: 'priority' })).toBe('priority');
    expect(getPanelSortKey({ sortKey: 'nonsense' })).toBeUndefined();
    // ...but an unknown key survives a save of this client's editor.
    expect(withPanelSortKey(panel({}), 'futureKey' as any).sortKey).toBe('futureKey');
    expect(getPanelSortKey({})).toBeUndefined();
  });
});

describe('sanitizePanelCfg: rule fields', () => {
  it('drops null and empty values and keeps unknown strings', () => {
    const out = sanitizePanelCfg({
      ...basePanel,
      deadlineState: null,
      estimateRule: '',
      timeSpentRule: 'futureRule',
      priorityRule: null,
      sortKey: '',
      isUntagged: null,
    } as any);
    expect('deadlineState' in out).toBeFalse();
    expect('estimateRule' in out).toBeFalse();
    expect(out.timeSpentRule).toBe('futureRule');
    expect('priorityRule' in out).toBeFalse();
    expect('sortKey' in out).toBeFalse();
    expect('isUntagged' in out).toBeFalse();
  });
});

describe('normalizeBoardForSave', () => {
  const board = (panels: Partial<BoardPanelCfg>[]): BoardCfg => ({
    id: 'b',
    title: 'B',
    cols: 1,
    panels: panels.map((p) => ({ ...basePanel, ...p })),
  });

  it('turns the form sort select into sortBy or sortKey', () => {
    const out = normalizeBoardForSave(
      board([
        { sortKey: 'plannedDate' },
        { sortKey: 'priority' },
        { sortKey: null as any },
      ]),
    );
    expect(out.panels[0].sortBy).toBe('dueDate');
    expect('sortKey' in out.panels[0]).toBeFalse();
    expect(out.panels[1].sortKey).toBe('priority');
    expect('sortBy' in out.panels[2] || 'sortKey' in out.panels[2]).toBeFalse();
  });

  it('clears the hidden tag lists of an untagged column and drops a false flag', () => {
    const out = normalizeBoardForSave(
      board([
        { isUntagged: true, includedTagIds: ['a'], excludedTagIds: ['b'] },
        { isUntagged: false, includedTagIds: ['a'] },
      ]),
    );
    expect(out.panels[0].includedTagIds).toEqual([]);
    expect(out.panels[0].excludedTagIds).toEqual([]);
    expect('isUntagged' in out.panels[1]).toBeFalse();
    expect(out.panels[1].includedTagIds).toEqual(['a']);
  });

  it('drops Formly nulls before they reach an op', () => {
    const out = normalizeBoardForSave(board([{ deadlineState: null as any }]));
    expect('deadlineState' in out.panels[0]).toBeFalse();
  });
});

describe('toEditorModel: an untouched save keeps the stored board', () => {
  for (const fixture of UNTOUCHED_SAVE_FIXTURES) {
    it(fixture.name, () => {
      expect(normalizeBoardForSave(toEditorModel(fixture.board))).toEqual(fixture.saved);
    });
  }

  it('holds the sort of sortBy in sortKey, which normalize needs', () => {
    const model = toEditorModel({
      id: 'b',
      title: 'B',
      cols: 1,
      panels: [{ ...basePanel, sortBy: 'dueDate' }],
    });
    expect(model.panels[0].sortKey).toBe('plannedDate');
    // Without it, normalize would delete the sort.
    const withoutKey = { ...model.panels[0], sortKey: undefined };
    expect(
      normalizeBoardForSave({ ...model, panels: [withoutKey] }).panels[0].sortBy,
    ).toBeUndefined();
  });

  it('fills defaults that legacy data lacks', () => {
    const legacy = {
      id: 'b',
      title: 'B',
      panels: [{ id: 'p', title: 'P', taskIds: [] }],
    } as unknown as BoardCfg;
    const model = toEditorModel(legacy);
    expect(model.cols).toBe(1);
    expect(model.panels[0].projectIds).toEqual(['']);
    expect(model.panels[0].taskDoneState).toBe(BoardPanelCfgTaskDoneState.All);
    expect(model.panels[0].backlogState).toBe(BoardPanelCfgTaskTypeFilter.All);
  });
});

describe('criteriaToPanelFields', () => {
  it('round-trips through panelToCriteria', () => {
    const fields = criteriaToPanelFields({
      includedTagIds: ['a'],
      includedTagsMatch: 'any',
      plannedDate: 'nextWeek',
      deadline: 'none',
      estimate: 'none',
      timeSpent: 600000,
      priority: 2,
    });
    expect(panelToCriteria({ ...basePanel, ...fields })).toEqual(
      jasmine.objectContaining({
        includedTagIds: ['a'],
        includedTagsMatch: 'any',
        plannedDate: 'nextWeek',
        deadline: 'none',
        estimate: 'none',
        timeSpent: 600000,
        priority: 2,
      }),
    );
  });

  it('maps "no planned date" to the not-scheduled state and no match to no project', () => {
    expect(criteriaToPanelFields({ plannedDate: 'none' }).scheduledState).toBe(
      BoardPanelCfgScheduledState.NotScheduled,
    );
    // A column can't say "matches nothing"; callers handle isNoMatch first.
    expect(criteriaToPanelFields({ isNoMatch: true }).projectIds).toBeUndefined();
  });
});

describe('getViewIcon', () => {
  it('shows a list for one column and a board for several', () => {
    expect(getViewIcon({ panels: [basePanel] })).toBe('filter_list');
    expect(getViewIcon({ panels: [basePanel, basePanel] })).toBe('view_kanban');
  });
});
