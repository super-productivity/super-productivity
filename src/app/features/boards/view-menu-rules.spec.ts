import {
  getPanelsWithViewFilter,
  getPanelsWithViewFilterPreset,
  getPanelsWithViewSort,
  getViewMenuState,
} from './view-menu-rules';
import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
} from './boards.model';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FilterOption,
  OPTIONS,
  SORT_OPTION_TYPE,
  SORT_ORDER,
  SortOption,
} from '../task-view-customizer/types';
import { sanitizePanelCfg } from './boards.util';

const panel = (overrides: Partial<BoardPanelCfg> = {}): BoardPanelCfg => ({
  id: 'p1',
  title: 'Panel',
  taskIds: ['t1'],
  includedTagIds: [],
  excludedTagIds: [],
  taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
  scheduledState: BoardPanelCfgScheduledState.All,
  isParentTasksOnly: true,
  projectIds: ['proj'],
  ...overrides,
});
const board = (...panels: BoardPanelCfg[]): BoardCfg => ({
  id: 'b1',
  title: 'View',
  cols: 1,
  panels,
});
const lookups = {
  tags: [
    { id: 'work', title: 'Work' },
    { id: 'home', title: 'Home' },
  ],
};
const sortOption = (type: SORT_OPTION_TYPE): SortOption =>
  OPTIONS.sort.list.find((opt) => opt.type === type)!;
const filterOption = (
  type: FILTER_OPTION_TYPE,
  preset: string | null = null,
): FilterOption => ({
  ...OPTIONS.filter.list.find((opt) => opt.type === type)!,
  preset,
});

/** No rule clear may leave `null` or `undefined` values in the op payload. */
const expectNoNullish = (panels: BoardPanelCfg[]): void => {
  for (const p of panels) {
    for (const [key, value] of Object.entries(p)) {
      expect(value).withContext(key).not.toBeNull();
      expect(value).withContext(key).not.toBeUndefined();
    }
  }
};

describe('view-menu-rules', () => {
  describe('getViewMenuState', () => {
    it('shows the sort all panels share, and manual order as default', () => {
      expect(getViewMenuState(board(panel(), panel({ id: 'p2' }))).sort).toEqual(
        DEFAULT_OPTIONS.sort,
      );
      const byTitle = getViewMenuState(
        board(
          panel({ sortBy: 'title', sortDir: 'desc' }),
          panel({ id: 'p2', sortBy: 'title', sortDir: 'desc' }),
        ),
      ).sort;
      expect(byTitle?.type).toBe(SORT_OPTION_TYPE.name);
      expect(byTitle?.order).toBe(SORT_ORDER.DESC);
      expect(getViewMenuState(board(panel({ sortKey: 'priority' }))).sort?.type).toBe(
        SORT_OPTION_TYPE.priority,
      );
    });

    it('shows no sort when the panels differ', () => {
      expect(
        getViewMenuState(board(panel({ sortBy: 'title' }), panel({ id: 'p2' }))).sort,
      ).toBeNull();
      expect(
        getViewMenuState(
          board(
            panel({ sortBy: 'title', sortDir: 'asc' }),
            panel({ id: 'p2', sortBy: 'title', sortDir: 'desc' }),
          ),
        ).sort,
      ).toBeNull();
    });

    it('shows each filter type all panels share, and none when no panel has it', () => {
      const state = getViewMenuState(
        board(
          panel({ priorityRule: '3', dueState: 'today' }),
          panel({ id: 'p2', priorityRule: '3', dueState: 'today' }),
        ),
      );
      expect(state.filters.priority?.preset).toBe('3');
      expect(state.filters.scheduledDate?.preset).toBe(FILTER_SCHEDULE.today);
      expect(state.filters.deadline).toBeUndefined();
      expect(state.filters.tag).toBeUndefined();
      expect(state.differingFilterTypes).toEqual([]);
    });

    it('maps "none" and "not scheduled" to "Not specified"', () => {
      const state = getViewMenuState(
        board(
          panel({
            scheduledState: BoardPanelCfgScheduledState.NotScheduled,
            estimateRule: 'none',
            isUntagged: true,
          }),
        ),
      );
      expect(state.filters.scheduledDate?.preset).toBe(FILTER_COMMON.NOT_SPECIFIED);
      expect(state.filters.estimatedTime?.preset).toBe(FILTER_COMMON.NOT_SPECIFIED);
      expect(state.filters.tag?.preset).toBe(FILTER_COMMON.NOT_SPECIFIED);
    });

    it('reads rules a released client contradicted as panelToCriteria does', () => {
      const state = getViewMenuState(
        board(
          panel({
            dueState: 'today',
            scheduledState: BoardPanelCfgScheduledState.NotScheduled,
            isUntagged: true,
            includedTagIds: ['work'],
          }),
        ),
      );
      expect(state.filters.scheduledDate?.preset).toBe(FILTER_COMMON.NOT_SPECIFIED);
      expect(state.filters.tag?.preset).toBeNull();
      expect(state.filters.tag?.tagIds).toEqual(['work']);
    });

    it('shows required tags with their match mode', () => {
      const tag = getViewMenuState(
        board(panel({ includedTagIds: ['work', 'home'], includedTagsMatch: 'any' })),
      ).filters.tag;
      expect(tag?.tagIds).toEqual(['work', 'home']);
      expect(tag?.tagFilterMode).toBe('OR');
    });

    it('marks a type whose rule differs per panel', () => {
      const state = getViewMenuState(
        board(
          panel({ includedTagIds: ['work'], priorityRule: '1' }),
          panel({ id: 'p2', includedTagIds: ['home'], priorityRule: '1' }),
          panel({ id: 'p3', excludedTagIds: ['work', 'home'], priorityRule: '1' }),
        ),
      );
      expect(state.differingFilterTypes).toEqual([FILTER_OPTION_TYPE.tag]);
      expect(state.filters.tag).toBeUndefined();
      expect(state.filters.priority?.preset).toBe('1');
    });

    it('treats a rule on some panels only as differing', () => {
      expect(
        getViewMenuState(board(panel({ deadlineState: 'today' }), panel({ id: 'p2' })))
          .differingFilterTypes,
      ).toEqual([FILTER_OPTION_TYPE.deadline]);
    });

    it('shows a rule without a menu preset as set, with no preset checked', () => {
      const scheduled = getViewMenuState(board(panel({ dueState: 'overdue' }))).filters
        .scheduledDate;
      expect(scheduled?.preset).toBe('overdue');
    });
  });

  describe('getPanelsWithViewSort', () => {
    it('sets the sort on every panel', () => {
      const panels = getPanelsWithViewSort(
        board(panel(), panel({ id: 'p2', sortBy: 'created', sortDir: 'desc' })),
        sortOption(SORT_OPTION_TYPE.deadline),
      );
      expect(panels.map((p) => [p.sortKey, p.sortBy, p.sortDir])).toEqual([
        ['deadline', undefined, 'asc'],
        ['deadline', undefined, 'asc'],
      ]);
      expectNoNullish(panels);
    });

    it('writes keys released clients know into sortBy', () => {
      const [p] = getPanelsWithViewSort(
        board(panel({ sortKey: 'priority' })),
        sortOption(SORT_OPTION_TYPE.name),
      );
      expect(p.sortBy).toBe('title');
      expect('sortKey' in p).toBeFalse();
    });

    it('flips the direction when the shared sort is picked again', () => {
      const asc = board(panel({ sortBy: 'title', sortDir: 'asc' }));
      const [flipped] = getPanelsWithViewSort(asc, sortOption(SORT_OPTION_TYPE.name));
      expect(flipped.sortDir).toBe('desc');
      const [back] = getPanelsWithViewSort(
        board(flipped),
        sortOption(SORT_OPTION_TYPE.name),
      );
      expect(back.sortDir).toBe('asc');
    });

    it('goes back to manual order with "Default", keeping the order', () => {
      const [p] = getPanelsWithViewSort(
        board(panel({ sortBy: 'title', sortDir: 'desc' })),
        DEFAULT_OPTIONS.sort,
      );
      expect('sortBy' in p).toBeFalse();
      expect('sortKey' in p).toBeFalse();
      expect('sortDir' in p).toBeFalse();
      expect(p.taskIds).toEqual(['t1']);
    });

    it('leaves the rules alone', () => {
      const [p] = getPanelsWithViewSort(
        board(panel({ priorityRule: '2', includedTagIds: ['work'] })),
        sortOption(SORT_OPTION_TYPE.creationDate),
      );
      expect(p.priorityRule).toBe('2');
      expect(p.includedTagIds).toEqual(['work']);
    });
  });

  describe('getPanelsWithViewFilter(Preset)', () => {
    it('sets a rule on every panel and leaves other rules alone', () => {
      const panels = getPanelsWithViewFilterPreset(
        board(
          panel({ includedTagIds: ['work'] }),
          panel({ id: 'p2', includedTagIds: ['home'], deadlineState: 'today' }),
        ),
        FILTER_OPTION_TYPE.priority,
        '3',
        lookups,
      )!;
      expect(panels.map((p) => p.priorityRule)).toEqual(['3', '3']);
      expect(panels.map((p) => p.includedTagIds)).toEqual([['work'], ['home']]);
      expect(panels[1].deadlineState).toBe('today');
      expectNoNullish(panels);
    });

    it('clears the rule when the checked preset is clicked again', () => {
      const panels = getPanelsWithViewFilterPreset(
        board(
          panel({ estimateRule: '1800000' }),
          panel({ id: 'p2', estimateRule: '1800000' }),
        ),
        FILTER_OPTION_TYPE.estimatedTime,
        '1800000',
        lookups,
      )!;
      expect(panels.every((p) => !('estimateRule' in p))).toBeTrue();
      expectNoNullish(panels);
    });

    it('replaces a different preset', () => {
      const [p] = getPanelsWithViewFilterPreset(
        board(panel({ deadlineState: 'today' })),
        FILTER_OPTION_TYPE.deadline,
        FILTER_SCHEDULE.nextWeek,
        lookups,
      )!;
      expect(p.deadlineState).toBe('nextWeek');
    });

    it('sets a planned-date rule as scheduled, and "Not specified" as unscheduled', () => {
      const [due] = getPanelsWithViewFilterPreset(
        board(panel()),
        FILTER_OPTION_TYPE.scheduledDate,
        FILTER_SCHEDULE.thisWeek,
        lookups,
      )!;
      expect(due.dueState).toBe('thisWeek');
      expect(due.scheduledState).toBe(BoardPanelCfgScheduledState.Scheduled);

      const [unscheduled] = getPanelsWithViewFilterPreset(
        board(due),
        FILTER_OPTION_TYPE.scheduledDate,
        FILTER_COMMON.NOT_SPECIFIED,
        lookups,
      )!;
      expect('dueState' in unscheduled).toBeFalse();
      expect(unscheduled.scheduledState).toBe(BoardPanelCfgScheduledState.NotScheduled);
    });

    it('clears a planned date by deleting dueState and showing all', () => {
      const [p] = getPanelsWithViewFilterPreset(
        board(
          panel({
            dueState: 'today',
            scheduledState: BoardPanelCfgScheduledState.Scheduled,
          }),
        ),
        FILTER_OPTION_TYPE.scheduledDate,
        FILTER_SCHEDULE.today,
        lookups,
      )!;
      expect('dueState' in p).toBeFalse();
      expect(p.scheduledState).toBe(BoardPanelCfgScheduledState.All);
      expectNoNullish([p]);
    });

    it('sets and clears tags, keeping excluded tags', () => {
      const withTags = getPanelsWithViewFilter(
        board(panel({ excludedTagIds: ['home'] })),
        FILTER_OPTION_TYPE.tag,
        {
          ...filterOption(FILTER_OPTION_TYPE.tag),
          tagIds: ['work'],
          tagFilterMode: 'AND',
        },
        lookups,
      )!;
      expect(withTags[0].includedTagIds).toEqual(['work']);
      expect(withTags[0].includedTagsMatch).toBe('all');
      expect(withTags[0].excludedTagIds).toEqual(['home']);

      const cleared = getPanelsWithViewFilter(
        board(...withTags),
        FILTER_OPTION_TYPE.tag,
        null,
        lookups,
      )!;
      expect(cleared[0].includedTagIds).toEqual([]);
      expect('includedTagsMatch' in cleared[0]).toBeFalse();
      expect(cleared[0].excludedTagIds).toEqual(['home']);
      expectNoNullish(cleared);
    });

    it('drops deleted tags and clears the rule when none is left', () => {
      const [p] = getPanelsWithViewFilter(
        board(panel({ includedTagIds: ['work'] })),
        FILTER_OPTION_TYPE.tag,
        { ...filterOption(FILTER_OPTION_TYPE.tag), tagIds: ['gone'] },
        lookups,
      )!;
      expect(p.includedTagIds).toEqual([]);
    });

    it('toggles "untagged"', () => {
      const [untagged] = getPanelsWithViewFilterPreset(
        board(panel({ includedTagIds: ['work'] })),
        FILTER_OPTION_TYPE.tag,
        FILTER_COMMON.NOT_SPECIFIED,
        lookups,
      )!;
      expect(untagged.isUntagged).toBeTrue();
      expect(untagged.includedTagIds).toEqual([]);
      const [back] = getPanelsWithViewFilterPreset(
        board(untagged),
        FILTER_OPTION_TYPE.tag,
        FILTER_COMMON.NOT_SPECIFIED,
        lookups,
      )!;
      expect('isUntagged' in back).toBeFalse();
    });

    it('refuses a type whose rule differs per panel', () => {
      expect(
        getPanelsWithViewFilterPreset(
          board(panel({ includedTagIds: ['work'] }), panel({ id: 'p2' })),
          FILTER_OPTION_TYPE.tag,
          FILTER_COMMON.NOT_SPECIFIED,
          lookups,
        ),
      ).toBeNull();
    });

    it('refuses the project search', () => {
      expect(
        getPanelsWithViewFilter(
          board(panel()),
          FILTER_OPTION_TYPE.project,
          filterOption(FILTER_OPTION_TYPE.project, 'x'),
          lookups,
        ),
      ).toBeNull();
    });

    it("keeps the sort and a newer client's unknown sort key", () => {
      const [sorted] = getPanelsWithViewFilterPreset(
        board(panel({ sortBy: 'title', sortDir: 'desc' })),
        FILTER_OPTION_TYPE.priority,
        '1',
        lookups,
      )!;
      expect(sorted.sortBy).toBe('title');
      expect(sorted.sortDir).toBe('desc');
      const [unknown] = getPanelsWithViewFilterPreset(
        board(panel({ sortKey: 'future' })),
        FILTER_OPTION_TYPE.priority,
        '1',
        lookups,
      )!;
      expect(unknown.sortKey).toBe('future');
    });

    it('produces panels the reducer stores unchanged', () => {
      const panels = getPanelsWithViewFilterPreset(
        board(
          panel({
            dueState: 'today',
            scheduledState: BoardPanelCfgScheduledState.Scheduled,
          }),
        ),
        FILTER_OPTION_TYPE.scheduledDate,
        FILTER_SCHEDULE.today,
        lookups,
      )!;
      expect(panels.map(sanitizePanelCfg)).toEqual(panels);
    });
  });
});
