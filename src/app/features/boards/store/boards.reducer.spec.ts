import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import { boardsReducer, BoardsState } from './boards.reducer';
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
