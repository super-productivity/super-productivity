import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import { boardsReducer, BoardsState, deduplicatePanelIds } from './boards.reducer';
import { BoardsActions } from './boards.actions';

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
