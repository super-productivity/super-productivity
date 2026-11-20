import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import {
  boardsReducer,
  BoardsState,
  deduplicatePanelIds,
  fixBuggyDefaultBoardFilters,
} from './boards.reducer';
import { IN_PROGRESS_TAG } from '../../tag/tag.const';
import { BoardsActions } from './boards.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';

const makePanel = (overrides: Partial<BoardPanelCfg> = {}): BoardPanelCfg => ({
  id: 'panel-default',
  title: 'Panel',
  taskIds: [],
  includedTagIds: [],
  excludedTagIds: [],
  taskDoneState: BoardPanelCfgTaskDoneState.All,
  scheduledState: BoardPanelCfgScheduledState.All,
  backlogState: BoardPanelCfgTaskTypeFilter.All,
  isParentTasksOnly: false,
  projectIds: [''],
  ...overrides,
});

const makeBoard = (overrides: Partial<BoardCfg> = {}): BoardCfg => ({
  id: 'board-default',
  title: 'Board',
  cols: 2,
  panels: [],
  ...overrides,
});

describe('Boards Reducer - updatePanelCfgTaskIds', () => {
  it('should update taskIds for the correct panel when panel IDs are unique', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'board-1',
          panels: [
            makePanel({ id: 'panel-A', taskIds: ['t1', 't2'] }),
            makePanel({ id: 'panel-B', taskIds: ['t3'] }),
          ],
        }),
        makeBoard({
          id: 'board-2',
          panels: [
            makePanel({ id: 'panel-C', taskIds: ['t4', 't5'] }),
            makePanel({ id: 'panel-D', taskIds: ['t6'] }),
          ],
        }),
      ],
    };

    const result = boardsReducer(
      state,
      BoardsActions.updatePanelCfgTaskIds({
        panelId: 'panel-C',
        taskIds: ['t5', 't4'],
      }),
    );

    expect(result.boardCfgs[1].panels[0].taskIds).toEqual(['t5', 't4']);
    expect(result.boardCfgs[0].panels[0].taskIds).toEqual(['t1', 't2']);
  });

  it('should update the first matching panel when duplicate panel IDs exist', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'board-1',
          panels: [makePanel({ id: 'SHARED_ID', taskIds: ['t1'] })],
        }),
        makeBoard({
          id: 'board-2',
          panels: [makePanel({ id: 'SHARED_ID', taskIds: ['t2'] })],
        }),
      ],
    };

    const result = boardsReducer(
      state,
      BoardsActions.updatePanelCfgTaskIds({
        panelId: 'SHARED_ID',
        taskIds: ['t3'],
      }),
    );

    // With duplicate IDs, reducer always updates the first board — this is the bug
    expect(result.boardCfgs[0].panels[0].taskIds).toEqual(['t3']);
    // Second board is never updated — confirming why unique IDs are required
    expect(result.boardCfgs[1].panels[0].taskIds).toEqual(['t2']);
  });
});

describe('deduplicatePanelIds', () => {
  it('should return state unchanged when all panel IDs are unique', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'board-1',
          panels: [makePanel({ id: 'panel-A' }), makePanel({ id: 'panel-B' })],
        }),
        makeBoard({
          id: 'board-2',
          panels: [makePanel({ id: 'panel-C' })],
        }),
      ],
    };

    const result = deduplicatePanelIds(state);
    expect(result).toBe(state);
  });

  it('should replace duplicate panel IDs with unique ones', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'board-1',
          panels: [
            makePanel({ id: 'SHARED', title: 'Original' }),
            makePanel({ id: 'unique-1' }),
          ],
        }),
        makeBoard({
          id: 'board-2',
          panels: [makePanel({ id: 'SHARED', title: 'Copy' })],
        }),
      ],
    };

    const result = deduplicatePanelIds(state);

    // First occurrence keeps its ID
    expect(result.boardCfgs[0].panels[0].id).toBe('SHARED');
    // Second occurrence gets a new unique ID
    expect(result.boardCfgs[1].panels[0].id).not.toBe('SHARED');
    expect(result.boardCfgs[1].panels[0].id.length).toBeGreaterThan(0);
    // Other properties are preserved
    expect(result.boardCfgs[1].panels[0].title).toBe('Copy');
    // Unique panels are untouched
    expect(result.boardCfgs[0].panels[1].id).toBe('unique-1');
  });

  it('should handle multiple duplicate panel IDs across boards', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'board-1',
          panels: [makePanel({ id: 'A' }), makePanel({ id: 'B' })],
        }),
        makeBoard({
          id: 'board-2',
          panels: [makePanel({ id: 'A' }), makePanel({ id: 'B' })],
        }),
      ],
    };

    const result = deduplicatePanelIds(state);

    expect(result.boardCfgs[0].panels[0].id).toBe('A');
    expect(result.boardCfgs[0].panels[1].id).toBe('B');
    expect(result.boardCfgs[1].panels[0].id).not.toBe('A');
    expect(result.boardCfgs[1].panels[1].id).not.toBe('B');
    // All IDs should be unique
    const allIds = result.boardCfgs.flatMap((b) => b.panels.map((p) => p.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe('Boards Reducer - sortBoards', () => {
  it('reorders boardCfgs to match the given id list', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({ id: 'b1', title: 'One' }),
        makeBoard({ id: 'b2', title: 'Two' }),
        makeBoard({ id: 'b3', title: 'Three' }),
      ],
    };

    const result = boardsReducer(
      state,
      BoardsActions.sortBoards({ ids: ['b3', 'b1', 'b2'] }),
    );

    expect(result.boardCfgs.map((b) => b.id)).toEqual(['b3', 'b1', 'b2']);
  });

  it('appends boards missing from the id list to preserve them', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({ id: 'b1' }),
        makeBoard({ id: 'b2' }),
        makeBoard({ id: 'b3' }),
      ],
    };

    const result = boardsReducer(state, BoardsActions.sortBoards({ ids: ['b3', 'b1'] }));

    expect(result.boardCfgs.map((b) => b.id)).toEqual(['b3', 'b1', 'b2']);
  });
});

describe('Boards Reducer - updateBoard leaves manual order to reorders (#11388)', () => {
  const stored = (): BoardsState => ({
    boardCfgs: [
      makeBoard({
        id: 'b1',
        panels: [
          makePanel({ id: 'p1', title: 'Main', taskIds: ['t1', 't2', 't3'] }),
          makePanel({ id: 'p2', title: 'Other', taskIds: ['t4'] }),
        ],
      }),
    ],
  });
  // What a device that hasn't seen the reorder saves: its stale order.
  const edit = BoardsActions.updateBoard({
    id: 'b1',
    updates: {
      title: 'Edited',
      panels: [
        makePanel({ id: 'p1', title: 'Main edited', taskIds: ['t1', 't2', 't3'] }),
        makePanel({ id: 'p2', title: 'Other', taskIds: ['t4'] }),
      ],
    },
  });
  const reorder = BoardsActions.updatePanelCfgTaskIds({
    panelId: 'p1',
    taskIds: ['t3', 't1', 't2'],
  });

  it('applies the edit but keeps the stored order of a panel it already has', () => {
    const state = boardsReducer(stored(), reorder);

    const board = boardsReducer(state, edit).boardCfgs[0];

    expect(board.title).toBe('Edited');
    expect(board.panels[0]).toEqual(
      jasmine.objectContaining({ title: 'Main edited', taskIds: ['t3', 't1', 't2'] }),
    );
    expect(board.panels[1].taskIds).toEqual(['t4']);
  });

  it('ends in the same state whichever of a reorder and an edit applies first', () => {
    const reorderFirst = boardsReducer(boardsReducer(stored(), reorder), edit);
    const editFirst = boardsReducer(boardsReducer(stored(), edit), reorder);

    expect(reorderFirst).toEqual(editFirst);
  });

  it('takes the order of a panel the edit adds', () => {
    const result = boardsReducer(
      stored(),
      BoardsActions.updateBoard({
        id: 'b1',
        updates: {
          panels: [
            makePanel({ id: 'p1', taskIds: ['t1', 't2', 't3'] }),
            makePanel({ id: 'p3', title: 'New', taskIds: ['t5'] }),
          ],
        },
      }),
    );

    expect(result.boardCfgs[0].panels.map((p) => [p.id, p.taskIds])).toEqual([
      ['p1', ['t1', 't2', 't3']],
      ['p3', ['t5']],
    ]);
  });

  it('keeps a panel the edit removes removed, also for a later reorder', () => {
    const removeP1 = BoardsActions.updateBoard({
      id: 'b1',
      updates: { panels: [makePanel({ id: 'p2', title: 'Other', taskIds: ['t4'] })] },
    });

    const removeFirst = boardsReducer(boardsReducer(stored(), removeP1), reorder);
    const reorderFirst = boardsReducer(boardsReducer(stored(), reorder), removeP1);

    expect(removeFirst.boardCfgs[0].panels.map((p) => p.id)).toEqual(['p2']);
    expect(reorderFirst).toEqual(removeFirst);
  });
});

describe('Boards Reducer - panel cfg sanitization', () => {
  it('migrates legacy sortByDue on loadAllData', () => {
    const stored: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'b1',
          panels: [makePanel({ id: 'p1', sortByDue: 'asc' } as Partial<BoardPanelCfg>)],
        }),
      ],
    };
    const appDataComplete = { boards: stored } as unknown as AppDataComplete;

    const result = boardsReducer({ boardCfgs: [] }, loadAllData({ appDataComplete }));

    const panel = result.boardCfgs[0].panels[0];
    expect(panel.sortBy).toBe('dueDate');
    expect(panel.sortDir).toBe('asc');
    expect('sortByDue' in panel).toBe(false);
  });

  it('scrubs null sortBy/match-mode fields in updateBoard', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'b1',
          panels: [makePanel({ id: 'p1' })],
        }),
      ],
    };

    const updates = {
      panels: [
        makePanel({
          id: 'p1',
          sortBy: null as any,
          sortDir: null as any,
          includedTagsMatch: null as any,
        }),
      ],
    };

    const result = boardsReducer(state, BoardsActions.updateBoard({ id: 'b1', updates }));

    const panel = result.boardCfgs[0].panels[0];
    expect('sortBy' in panel).toBe(false);
    expect('sortDir' in panel).toBe(false);
    expect('includedTagsMatch' in panel).toBe(false);
  });

  it('scrubs legacy sortByDue on addBoard', () => {
    const board = makeBoard({
      id: 'new',
      panels: [makePanel({ id: 'p1', sortByDue: 'desc' } as Partial<BoardPanelCfg>)],
    });

    const result = boardsReducer({ boardCfgs: [] }, BoardsActions.addBoard({ board }));

    const panel = result.boardCfgs[0].panels[0];
    expect(panel.sortBy).toBe('dueDate');
    expect(panel.sortDir).toBe('desc');
    expect('sortByDue' in panel).toBe(false);
  });
});

describe('Boards Reducer - loadAllData with malformed payload (#7666)', () => {
  it('does not throw when boardCfgs is undefined', () => {
    const appDataComplete = {
      boards: { boardCfgs: undefined } as unknown as BoardsState,
    } as unknown as AppDataComplete;

    expect(() =>
      boardsReducer({ boardCfgs: [] }, loadAllData({ appDataComplete })),
    ).not.toThrow();

    const result = boardsReducer({ boardCfgs: [] }, loadAllData({ appDataComplete }));
    expect(result.boardCfgs).toEqual([]);
  });

  it('does not throw when a board has undefined panels', () => {
    const appDataComplete = {
      boards: {
        boardCfgs: [
          { id: 'b1', title: 'B1', cols: 2, panels: undefined } as unknown as BoardCfg,
        ],
      },
    } as unknown as AppDataComplete;

    expect(() =>
      boardsReducer({ boardCfgs: [] }, loadAllData({ appDataComplete })),
    ).not.toThrow();

    const result = boardsReducer({ boardCfgs: [] }, loadAllData({ appDataComplete }));
    expect(result.boardCfgs[0].panels).toEqual([]);
  });
});

describe('fixBuggyDefaultBoardFilters (#7498)', () => {
  const eisenhowerPanelIds = [
    'URGENT_AND_IMPORTANT',
    'NOT_URGENT_AND_IMPORTANT',
    'URGENT_AND_NOT_IMPORTANT',
    'NOT_URGENT_AND_NOT_IMPORTANT',
  ];

  // #8723: the Eisenhower taskDoneState revert used to run on every load and
  // clobbered a user's intentional "Not Completed" (UnDone) choice back to All.
  it('preserves an intentional UnDone taskDoneState on the Eisenhower quadrants', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'EISENHOWER_MATRIX',
          panels: eisenhowerPanelIds.map((id) =>
            makePanel({ id, taskDoneState: BoardPanelCfgTaskDoneState.UnDone }),
          ),
        }),
      ],
    };

    const result = fixBuggyDefaultBoardFilters(state);

    expect(result).toBe(state);
    for (const panel of result.boardCfgs[0].panels) {
      expect(panel.taskDoneState).toBe(BoardPanelCfgTaskDoneState.UnDone);
    }
  });

  it('strips IN_PROGRESS_TAG from the Kanban DONE panel excludedTagIds', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'KANBAN_DEFAULT',
          panels: [
            makePanel({
              id: 'DONE',
              excludedTagIds: [IN_PROGRESS_TAG.id, 'OTHER_TAG'],
            }),
          ],
        }),
      ],
    };

    const result = fixBuggyDefaultBoardFilters(state);

    expect(result.boardCfgs[0].panels[0].excludedTagIds).toEqual(['OTHER_TAG']);
  });

  it('does not touch Kanban DONE if IN_PROGRESS_TAG already absent (idempotent)', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'KANBAN_DEFAULT',
          panels: [makePanel({ id: 'DONE', excludedTagIds: [] })],
        }),
      ],
    };

    const result = fixBuggyDefaultBoardFilters(state);

    expect(result).toBe(state);
  });

  it('does not touch a panel named DONE on a non-Kanban board', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'CUSTOM_BOARD',
          panels: [makePanel({ id: 'DONE', excludedTagIds: [IN_PROGRESS_TAG.id] })],
        }),
      ],
    };

    const result = fixBuggyDefaultBoardFilters(state);

    expect(result).toBe(state);
  });

  it('migrates the Kanban default while leaving an Eisenhower UnDone choice intact', () => {
    const state: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'EISENHOWER_MATRIX',
          panels: [
            makePanel({
              id: 'URGENT_AND_IMPORTANT',
              taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
            }),
          ],
        }),
        makeBoard({
          id: 'KANBAN_DEFAULT',
          panels: [
            makePanel({
              id: 'DONE',
              excludedTagIds: [IN_PROGRESS_TAG.id],
            }),
          ],
        }),
      ],
    };

    const result = fixBuggyDefaultBoardFilters(state);

    expect(result.boardCfgs[0].panels[0].taskDoneState).toBe(
      BoardPanelCfgTaskDoneState.UnDone,
    );
    expect(result.boardCfgs[1].panels[0].excludedTagIds).toEqual([]);
  });
});

describe('Boards Reducer - loadAllData preserves Eisenhower taskDoneState (#8723)', () => {
  it('keeps a user-set "Not Completed" (UnDone) quadrant across a reload', () => {
    const stored: BoardsState = {
      boardCfgs: [
        makeBoard({
          id: 'EISENHOWER_MATRIX',
          panels: [
            makePanel({
              id: 'URGENT_AND_IMPORTANT',
              taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
            }),
          ],
        }),
      ],
    };
    const appDataComplete = { boards: stored } as unknown as AppDataComplete;

    const result = boardsReducer({ boardCfgs: [] }, loadAllData({ appDataComplete }));

    expect(result.boardCfgs[0].panels[0].taskDoneState).toBe(
      BoardPanelCfgTaskDoneState.UnDone,
    );
  });
});
