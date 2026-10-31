import { buildViewFromList, ViewSourceList } from './save-as-view';
import { WorkContextType } from '../work-context/work-context.model';
import { TODAY_TAG } from '../tag/tag.const';
import { T } from '../../t.const';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FilterOption,
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
    ...overrides,
  });
  const filter = (overrides: Partial<FilterOption>): FilterOption => ({
    ...DEFAULT_OPTIONS.filter,
    ...overrides,
  });
  const buildWithHints = (
    source: ViewSourceList,
    opts: { filter?: FilterOption; sort?: SortOption; isGrouped?: boolean } = {},
  ): ReturnType<typeof buildViewFromList> =>
    buildViewFromList({
      list: source,
      filter: opts.filter ?? DEFAULT_OPTIONS.filter,
      sort: opts.sort ?? DEFAULT_OPTIONS.sort,
      isGrouped: !!opts.isGrouped,
      tags,
      projects,
    });
  const build = (
    source: ViewSourceList,
    opts: { filter?: FilterOption; sort?: SortOption } = {},
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

  it('maps Today to "today or overdue" with subtasks and without the virtual tag', () => {
    const panel = build(list({ type: WorkContextType.TAG, id: TODAY_TAG.id })).panels[0];
    expect(panel.dueState).toBe('todayOrOverdue');
    expect(panel.includedTagIds).toEqual([]);
    expect(panel.isParentTasksOnly).toBeFalse();
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
    expect(buildWithHints(list(), { isGrouped: true }).hints).toEqual([
      T.F.BOARDS.V.HINT_GROUPING_NOT_SAVED,
    ]);
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
});
