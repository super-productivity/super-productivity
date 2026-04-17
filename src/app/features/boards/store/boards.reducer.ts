import { createFeature, createReducer, on } from '@ngrx/store';
import { BoardsActions } from './boards.actions';
import { BoardCfg } from '../boards.model';
import { DEFAULT_BOARDS } from '../boards.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { nanoid } from 'nanoid';
import { sanitizePanelCfg } from '../boards.util';

const sanitizeBoard = (board: BoardCfg): BoardCfg => ({
  ...board,
  panels: (board.panels || []).map(sanitizePanelCfg),
});

const sanitizeBoardsState = (state: BoardsState): BoardsState => ({
  ...state,
  boardCfgs: state.boardCfgs.map(sanitizeBoard),
});

export const BOARDS_FEATURE_NAME = 'boards';

export interface BoardsState {
  boardCfgs: BoardCfg[];
}

export const initialBoardsState: BoardsState = {
  boardCfgs: DEFAULT_BOARDS,
};

/**
 * Fix for #6983: Replace duplicate panel IDs across boards with unique ones.
 * Boards duplicated before the fix in 99d9fac reused panel IDs from the original,
 * causing updatePanelCfgTaskIds to always match the first board's panel.
 */
export const deduplicatePanelIds = (boardsState: BoardsState): BoardsState => {
  const seenIds = new Set<string>();
  let changed = false;

  const boardCfgs = boardsState.boardCfgs.map((board) => {
    let boardChanged = false;
    const panels = board.panels.map((panel) => {
      if (seenIds.has(panel.id)) {
        changed = true;
        boardChanged = true;
        return { ...panel, id: nanoid() };
      }
      seenIds.add(panel.id);
      return panel;
    });
    return boardChanged ? { ...board, panels } : board;
  });

  return changed ? { ...boardsState, boardCfgs } : boardsState;
};

export const boardsReducer = createReducer(
  initialBoardsState,
  // META ACTIONS
  // ------------
  on(loadAllData, (state, { appDataComplete }) =>
    appDataComplete.boards
      ? sanitizeBoardsState(deduplicatePanelIds(appDataComplete.boards))
      : state,
  ),

  on(BoardsActions.addBoard, (state, { board }) => {
    return {
      ...state,
      boardCfgs: [...state.boardCfgs, sanitizeBoard(board)],
    };
  }),

  on(BoardsActions.updateBoard, (state, { id, updates }) => {
    const sanitizedUpdates = updates.panels
      ? { ...updates, panels: updates.panels.map(sanitizePanelCfg) }
      : updates;
    return {
      ...state,
      boardCfgs: state.boardCfgs.map((cfg) =>
        cfg.id === id ? { ...cfg, ...sanitizedUpdates } : cfg,
      ),
    };
  }),

  on(BoardsActions.removeBoard, (state, { id }) => {
    return {
      ...state,
      boardCfgs: state.boardCfgs.filter((cfg) => cfg.id !== id),
    };
  }),

  // on(BoardsActions.updatePanelCfg, (state, { panelCfg: panelCfgUpdate }) => {
  //   let panelCfgToUpdate;
  //   const boardCfg = state.boardCfgs.find((cfg) => {
  //     panelCfgToUpdate = cfg.panels.find((panel) => panel.id === panelCfgUpdate.id);
  //     return !!panelCfgToUpdate;
  //   });
  //
  //   if (boardCfg && panelCfgToUpdate) {
  //     return {
  //       ...state,
  //       boardCfgs: state.boardCfgs.map((boardCfgInner) => {
  //         if (boardCfgInner.id === boardCfg.id) {
  //           return {
  //             ...boardCfgInner,
  //             panels: boardCfgInner.panels.map((panel) => {
  //               if (panel.id === panelCfgUpdate.id) {
  //                 return {
  //                   ...panel,
  //                   ...panelCfgUpdate,
  //                 };
  //               }
  //               return panel;
  //             }),
  //           };
  //         }
  //         return boardCfgInner;
  //       }),
  //     };
  //   }
  //
  //   return state;
  // }),

  on(BoardsActions.updatePanelCfgTaskIds, (state, { panelId, taskIds }) => {
    let panelCfgToUpdate;
    const boardCfg = state.boardCfgs.find((cfg) => {
      panelCfgToUpdate = cfg.panels.find((panel) => panel.id === panelId);
      return !!panelCfgToUpdate;
    });

    if (boardCfg && panelCfgToUpdate) {
      return {
        ...state,
        boardCfgs: state.boardCfgs.map((boardCfgInner) => {
          if (boardCfgInner.id === boardCfg.id) {
            return {
              ...boardCfgInner,
              panels: boardCfgInner.panels.map((panel) => {
                if (panel.id === panelId) {
                  return {
                    ...panel,
                    taskIds,
                  };
                }
                return panel;
              }),
            };
          }
          return boardCfgInner;
        }),
      };
    }

    return state;
  }),
);

export const boardsFeature = createFeature({
  name: BOARDS_FEATURE_NAME,
  reducer: boardsReducer,
});
