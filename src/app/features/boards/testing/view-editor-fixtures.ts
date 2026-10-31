import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import { DEFAULT_BOARDS, DEFAULT_PANEL_CFG } from '../boards.const';

/**
 * Stored boards the view editor must save unchanged when the user changes
 * nothing (`normalizeBoardForSave(toEditorModel(board))`), and what that save
 * stores. Shared by the pure guard in `boards.util.spec.ts` and the editor's
 * own untouched-save test.
 */
export interface UntouchedSaveFixture {
  name: string;
  board: BoardCfg;
  /** What an untouched save stores (today's normalization). */
  saved: BoardCfg;
}

const panel = (fields: Partial<BoardPanelCfg> & { id: string }): BoardPanelCfg => ({
  ...DEFAULT_PANEL_CFG,
  title: `Section ${fields.id}`,
  ...fields,
});

const board = (
  id: string,
  panels: BoardPanelCfg[],
  extra: Partial<BoardCfg> = {},
): BoardCfg => ({ id, title: `View ${id}`, cols: 2, panels, ...extra });

const same = (name: string, b: BoardCfg): UntouchedSaveFixture => ({
  name,
  board: b,
  saved: b,
});

// Stored values only a newer client knows: a key and values this client
// doesn't read. They must survive this client's next `updateBoard`.
const unknownPanel = {
  ...panel({ id: 'unknown', dueState: 'nextQuarter', sortKey: 'energy' }),
  energyLevel: 'high',
} as BoardPanelCfg;

export const UNTOUCHED_SAVE_FIXTURES: UntouchedSaveFixture[] = [
  ...DEFAULT_BOARDS.map((b) => same(`default view ${b.id}`, b)),
  same(
    'a sortBy: dueDate panel (no sortKey)',
    board('sortBy', [panel({ id: 'a', sortBy: 'dueDate', sortDir: 'desc' })]),
  ),
  {
    // `sortBy` wins (released clients only know it): the shadowed key goes.
    name: 'a sortBy panel with a shadowed sortKey',
    board: board('shadowed', [
      panel({ id: 'a', sortBy: 'title', sortKey: 'priority', sortDir: 'asc' }),
    ]),
    saved: board('shadowed', [panel({ id: 'a', sortBy: 'title', sortDir: 'asc' })]),
  },
  same('unknown dueState, sortKey and panel key', board('unknown', [unknownPanel])),
  same(
    'an unknown board key',
    board('unknownBoard', [panel({ id: 'a' })], {
      layoutHint: 'masonry',
    } as Partial<BoardCfg>),
  ),
  same('cols: 8', board('cols8', [panel({ id: 'a' })], { cols: 8 })),
  same(
    'projectIds with a deleted project',
    board('deletedProject', [panel({ id: 'a', projectIds: ['p1', 'deleted-project'] })]),
  ),
  same(
    "dueState: 'none'",
    board('dueNone', [
      panel({
        id: 'a',
        dueState: 'none',
        scheduledState: BoardPanelCfgScheduledState.NotScheduled,
      }),
    ]),
  ),
  {
    // A date rule implies "scheduled" (released clients only know that).
    name: 'dueState with NotScheduled',
    board: board('dueNotScheduled', [
      panel({
        id: 'a',
        dueState: 'today',
        scheduledState: BoardPanelCfgScheduledState.NotScheduled,
      }),
    ]),
    saved: board('dueNotScheduled', [
      panel({
        id: 'a',
        dueState: 'today',
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
      }),
    ]),
  },
  {
    name: 'isUntagged with tags',
    board: board('untagged', [
      panel({
        id: 'a',
        isUntagged: true,
        includedTagIds: ['t1', 't2'],
        includedTagsMatch: 'any',
        excludedTagIds: ['t3'],
      }),
    ]),
    saved: board('untagged', [
      panel({ id: 'a', isUntagged: true, includedTagIds: [], excludedTagIds: [] }),
    ]),
  },
  same(
    'a single section titled differently from the view',
    board(
      'single',
      [
        panel({
          id: 'a',
          title: 'Open work',
          taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
          backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
        }),
      ],
      { cols: 1, title: 'My list' },
    ),
  ),
  same(
    'missing tags',
    board('missingTags', [
      panel({
        id: 'a',
        includedTagIds: ['missing-1', 'missing-2'],
        includedTagsMatch: 'any',
        excludedTagIds: ['missing-3'],
        excludedTagsMatch: 'all',
        priorityRule: '3',
        deadlineState: 'thisWeek',
        estimateRule: 'none',
        timeSpentRule: '600000',
        isParentTasksOnly: true,
        taskIds: ['t1', 't2'],
      }),
    ]),
  ),
];
