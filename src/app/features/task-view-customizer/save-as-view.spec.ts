import { buildViewFromList, getFilterTitle, ViewSourceList } from './save-as-view';
import { WorkContextType } from '../work-context/work-context.model';
import { TODAY_TAG } from '../tag/tag.const';
import { T } from '../../t.const';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FilterOption,
  GROUP_OPTION_TYPE,
  SORT_OPTION_TYPE,
  SORT_ORDER,
  SortOption,
} from './types';
import {
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards/boards.model';

describe('buildViewFromList', () => {
  const tags = [
    { id: 'work', title: 'Work' },
    { id: 'home', title: 'Home' },
  ];
  const projects = [{ id: 'p1', title: 'Website' }];
  const list = (overrides: Partial<ViewSourceList> = {}): ViewSourceList => ({
    type: WorkContextType.PROJECT,
    id: 'p1',
    title: 'Website',
    taskIds: ['a', 'b'],
    visibleTasks: [],
    ...overrides,
  });
  const filter = (overrides: Partial<FilterOption>): FilterOption => ({
    ...DEFAULT_OPTIONS.filter,
    ...overrides,
  });
  const buildWithHints = (
    source: ViewSourceList,
    opts: {
      filter?: FilterOption;
      sort?: SortOption;
      groupType?: GROUP_OPTION_TYPE;
      filterTitle?: string;
    } = {},
  ): ReturnType<typeof buildViewFromList> =>
    buildViewFromList({
      list: source,
      filter: opts.filter ?? DEFAULT_OPTIONS.filter,
      sort: opts.sort ?? DEFAULT_OPTIONS.sort,
      groupType: opts.groupType ?? null,
      tags,
      projects,
      otherSectionTitle: 'Other',
      filterTitle: opts.filterTitle,
    });
  const build = (
    source: ViewSourceList,
    opts: Parameters<typeof buildWithHints>[1] = {},
  ): ReturnType<typeof buildViewFromList>['board'] => buildWithHints(source, opts).board;

  it('makes a one-column view of a project list: undone parents, no backlog', () => {
    const board = build(list());
    expect(board.cols).toBe(1);
    expect(board.title).toBe('Website');
    expect(board.panels.length).toBe(1);
    expect(board.panels[0]).toEqual(
      jasmine.objectContaining({
        projectIds: ['p1'],
        backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
        taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
        isParentTasksOnly: true,
        // No sort: the column keeps the list's order.
        taskIds: ['a', 'b'],
      }),
    );
  });

  it('requires the tag for a tag list', () => {
    const panel = build(list({ type: WorkContextType.TAG, id: 'work' })).panels[0];
    expect(panel.includedTagIds).toEqual(['work']);
    expect(panel.projectIds).toEqual(['']);
  });

  it('maps an unfiltered Today to "today or overdue", untitled, with subtasks', () => {
    const board = build(list({ type: WorkContextType.TAG, id: TODAY_TAG.id }));
    const panel = board.panels[0];
    expect(panel.dueState).toBe('todayOrOverdue');
    expect(panel.includedTagIds).toEqual([]);
    expect(panel.isParentTasksOnly).toBeFalse();
    // "Today" doesn't name the view: the user does.
    expect(board.title).toBe('');
  });

  it('saves a filtered Today as the filter alone, named after it', () => {
    const { board, hints } = buildWithHints(
      list({ type: WorkContextType.TAG, id: TODAY_TAG.id, title: 'Today' }),
      {
        filter: filter({ type: FILTER_OPTION_TYPE.tag, tagIds: ['work'] }),
        filterTitle: 'Work',
      },
    );
    expect(board.title).toBe('Work');
    expect(board.panels[0].dueState).toBeUndefined();
    expect(board.panels[0].includedTagIds).toEqual(['work']);
    expect(hints).toEqual([T.F.BOARDS.V.HINT_FILTER_NOT_ONLY_TODAY]);

    // A filter that matches nothing can't be saved: Today's scope stays.
    const noMatch = build(list({ type: WorkContextType.TAG, id: TODAY_TAG.id }), {
      filter: filter({ type: FILTER_OPTION_TYPE.project, preset: 'nothing like it' }),
      filterTitle: 'x',
    });
    expect(noMatch.panels[0].dueState).toBe('todayOrOverdue');
    expect(noMatch.title).toBe('');
  });

  it('carries the filter over as column rules', () => {
    expect(
      build(list(), {
        filter: filter({
          type: FILTER_OPTION_TYPE.scheduledDate,
          preset: FILTER_SCHEDULE.thisWeek,
        }),
      }).panels[0].dueState,
    ).toBe('thisWeek');
    expect(
      build(list(), {
        filter: filter({
          type: FILTER_OPTION_TYPE.scheduledDate,
          preset: FILTER_COMMON.NOT_SPECIFIED,
        }),
      }).panels[0].scheduledState,
    ).toBe(BoardPanelCfgScheduledState.NotScheduled);
    expect(
      build(list(), {
        filter: filter({ type: FILTER_OPTION_TYPE.priority, preset: '3' }),
      }).panels[0].priorityRule,
    ).toBe('3');
    expect(
      build(list(), {
        filter: filter({ type: FILTER_OPTION_TYPE.estimatedTime, preset: '1800000' }),
      }).panels[0].estimateRule,
    ).toBe('1800000');
  });

  it("keeps a tag list's tag required next to a filter tag", () => {
    const panel = build(list({ type: WorkContextType.TAG, id: 'work' }), {
      filter: filter({ type: FILTER_OPTION_TYPE.tag, preset: null, tagIds: ['home'] }),
    }).panels[0];
    expect(panel.includedTagIds).toEqual(['work', 'home']);
    expect(panel.includedTagsMatch).toBe('all');
  });

  it('resolves a legacy title search to ids', () => {
    expect(
      build(list({ type: WorkContextType.TAG, id: 'work' }), {
        filter: filter({ type: FILTER_OPTION_TYPE.project, preset: 'web' }),
      }).panels[0].projectIds,
    ).toEqual(['p1']);
  });

  it('leaves out, with a hint, filter parts a column cannot combine with the list', () => {
    const noHits = buildWithHints(list(), {
      filter: filter({ type: FILTER_OPTION_TYPE.project, preset: 'nothing' }),
    });
    expect(noHits.board.panels[0].projectIds).toEqual(['p1']);
    expect(noHits.hints).toContain(T.F.BOARDS.V.HINT_FILTER_PART_NOT_SAVED);

    // A tag list filtered to "home OR other": one column can't say
    // "work AND (home OR other)", so the list's tag stays and the filter goes.
    const anyOf = buildWithHints(list({ type: WorkContextType.TAG, id: 'work' }), {
      filter: filter({
        type: FILTER_OPTION_TYPE.tag,
        preset: null,
        tagIds: ['home', 'work'],
        tagFilterMode: 'OR',
      }),
    });
    expect(anyOf.board.panels[0].includedTagIds).toEqual(['work']);
    expect(anyOf.hints).toContain(T.F.BOARDS.V.HINT_FILTER_PART_NOT_SAVED);

    const untagged = buildWithHints(list({ type: WorkContextType.TAG, id: 'work' }), {
      filter: filter({
        type: FILTER_OPTION_TYPE.tag,
        preset: FILTER_COMMON.NOT_SPECIFIED,
      }),
    });
    expect(untagged.board.panels[0].isUntagged).toBeUndefined();
    expect(untagged.board.panels[0].includedTagIds).toEqual(['work']);
  });

  it('names what the view does not carry over', () => {
    for (const groupType of [
      GROUP_OPTION_TYPE.project,
      GROUP_OPTION_TYPE.scheduledDate,
      GROUP_OPTION_TYPE.deadline,
    ]) {
      const grouped = buildWithHints(list(), { groupType });
      expect(grouped.hints).toEqual([T.F.BOARDS.V.HINT_GROUPING_NOT_SAVED]);
      expect(grouped.board.panels.length).toBe(1);
    }
    expect(
      buildWithHints(list({ type: WorkContextType.TAG, id: TODAY_TAG.id })).hints,
    ).toEqual([T.F.BOARDS.V.HINT_TODAY_OR_OVERDUE]);
    expect(buildWithHints(list()).hints).toEqual([]);
  });

  it('carries the sort over and then leaves the order to it', () => {
    const byPriority = build(list(), {
      sort: { type: SORT_OPTION_TYPE.priority, order: SORT_ORDER.DESC, label: '' },
    }).panels[0];
    expect(byPriority.sortKey).toBe('priority');
    expect(byPriority.sortDir).toBe('desc');
    expect(byPriority.taskIds).toEqual([]);
    const byTitle = build(list(), {
      sort: { type: SORT_OPTION_TYPE.name, order: SORT_ORDER.ASC, label: '' },
    }).panels[0];
    expect(byTitle.sortBy).toBe('title');
  });

  describe('grouped by tag', () => {
    const tagged = (...tagIds: string[]): { tagIds: string[] } => ({ tagIds });

    it('makes a section per carried tag in sidebar order, then "Other"', () => {
      const { board, hints } = buildWithHints(
        list({ visibleTasks: [tagged('home'), tagged('work', 'home'), tagged()] }),
        { groupType: GROUP_OPTION_TYPE.tag },
      );
      expect(hints).toEqual([]);
      expect(board.cols).toBe(1);
      expect(board.panels.map((p) => p.title)).toEqual(['Work', 'Home', 'Other']);
      const [work, home, other] = board.panels;
      expect(work.includedTagIds).toEqual(['work']);
      expect(work.includedTagsMatch).toBe('all');
      expect(home.includedTagIds).toEqual(['home']);
      // Base rules on every section.
      for (const p of board.panels) {
        expect(p.projectIds).toEqual(['p1']);
        expect(p.taskDoneState).toBe(BoardPanelCfgTaskDoneState.UnDone);
        expect(p.taskIds).toEqual(['a', 'b']);
      }
      expect(other.includedTagIds).toEqual([]);
      expect(other.excludedTagIds).toEqual(['work', 'home']);
      expect(other.excludedTagsMatch).toBe('any');
      expect(new Set(board.panels.map((p) => p.id)).size).toBe(3);
    });

    it("gives a tag list's own tag no section and keeps it on every section", () => {
      const grouped = buildWithHints(
        list({
          type: WorkContextType.TAG,
          id: 'work',
          visibleTasks: [tagged('work'), tagged('work', 'home')],
        }),
        { groupType: GROUP_OPTION_TYPE.tag },
      ).board;
      expect(grouped.panels.map((p) => p.title)).toEqual(['Home', 'Other']);
      expect(grouped.panels[0].includedTagIds).toEqual(['work', 'home']);
      // Tasks carrying only the list's tag land in "Other".
      expect(grouped.panels[1].includedTagIds).toEqual(['work']);
      expect(grouped.panels[1].excludedTagIds).toEqual(['home']);
    });

    it('adds the section tag to a filter tag', () => {
      const board = build(list({ visibleTasks: [tagged('work', 'home')] }), {
        filter: filter({ type: FILTER_OPTION_TYPE.tag, preset: null, tagIds: ['work'] }),
        groupType: GROUP_OPTION_TYPE.tag,
      });
      expect(board.panels.map((p) => p.includedTagIds)).toEqual([
        ['work', 'home'],
        ['work'],
      ]);
    });

    it('keeps one list, with the hint, when no task carries a tag to group by', () => {
      const { board, hints } = buildWithHints(list({ visibleTasks: [tagged()] }), {
        groupType: GROUP_OPTION_TYPE.tag,
      });
      expect(board.panels.length).toBe(1);
      expect(hints).toEqual([T.F.BOARDS.V.HINT_GROUPING_NOT_SAVED]);
    });

    it('skips tags that no longer exist', () => {
      const board = build(list({ visibleTasks: [tagged('gone', 'home')] }), {
        groupType: GROUP_OPTION_TYPE.tag,
      });
      expect(board.panels.map((p) => p.title)).toEqual(['Home', 'Other']);
    });
  });
});

describe('getFilterTitle', () => {
  const lookups = {
    tags: [
      { id: 'work', title: 'Work' },
      { id: 'home', title: 'Home' },
    ],
    projects: [{ id: 'p1', title: 'Website' }],
  };
  const title = (overrides: Partial<FilterOption>): string =>
    getFilterTitle(
      { ...DEFAULT_OPTIONS.filter, ...overrides },
      lookups,
      (key) => key.split('.').pop()!,
    );

  it('names tags and projects by their titles', () => {
    expect(title({ type: FILTER_OPTION_TYPE.tag, tagIds: ['work', 'home'] })).toBe(
      'Work, Home',
    );
    expect(title({ type: FILTER_OPTION_TYPE.project, preset: 'web' })).toBe('Website');
  });

  it('names other filters as the filter menu does', () => {
    expect(title({ type: FILTER_OPTION_TYPE.priority, preset: '3' })).toBe(
      'FILTER_PRIORITY: PRIORITY_HIGH',
    );
    expect(
      title({ type: FILTER_OPTION_TYPE.scheduledDate, preset: FILTER_SCHEDULE.today }),
    ).toBe('FILTER_SCHEDULED_DATE: SCHEDULED_TODAY');
    expect(
      title({ type: FILTER_OPTION_TYPE.deadline, preset: FILTER_SCHEDULE.thisWeek }),
    ).toBe('DEADLINE_THIS_WEEK');
    expect(
      title({ type: FILTER_OPTION_TYPE.tag, preset: FILTER_COMMON.NOT_SPECIFIED }),
    ).toBe('FILTER_TAG: FILTER_NOT_SPECIFIED');
  });

  it('is empty without a filter a view can carry', () => {
    expect(title({})).toBe('');
    expect(title({ type: FILTER_OPTION_TYPE.project, preset: 'nothing like it' })).toBe(
      '',
    );
  });
});
