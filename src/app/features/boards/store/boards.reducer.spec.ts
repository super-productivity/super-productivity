import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import { boardsReducer, BoardsState, deduplicatePanelIds } from './boards.reducer';
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
