import { createFeature, createReducer, on } from '@ngrx/store';
import { BoardsActions } from './boards.actions';
import { BoardCfg, BoardPanelCfgTaskDoneState } from '../boards.model';
import { DEFAULT_BOARDS } from '../boards.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { nanoid } from 'nanoid';
import { sanitizePanelCfg } from '../boards.util';
import { IN_PROGRESS_TAG } from '../../tag/tag.const';

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
 * Fix for #7498: pre-existing default boards persisted to user state still
 * have the buggy filters that make tasks vanish on done-toggle. We narrowly
 * patch only panels still matching the original default IDs so customized
 * panels are never touched. Idempotent: re-running is a no-op.
 */
const EISENHOWER_PANEL_IDS = new Set([
  'URGENT_AND_IMPORTANT',
  'NOT_URGENT_AND_IMPORTANT',
  'URGENT_AND_NOT_IMPORTANT',
  'NOT_URGENT_AND_NOT_IMPORTANT',
]);

export const fixBuggyDefaultBoardFilters = (boardsState: BoardsState): BoardsState => {
  let changed = false;

  const boardCfgs = boardsState.boardCfgs.map((board) => {
    let boardChanged = false;

    const panels = board.panels.map((panel) => {
      // Eisenhower quadrants: revert taskDoneState UnDone → All so completed
      // tasks remain visible (struck through) instead of vanishing — Eisenhower
      // has no Done column.
      if (
        board.id === 'EISENHOWER_MATRIX' &&
        EISENHOWER_PANEL_IDS.has(panel.id) &&
        panel.taskDoneState === BoardPanelCfgTaskDoneState.UnDone
      ) {
        boardChanged = true;
        return { ...panel, taskDoneState: BoardPanelCfgTaskDoneState.All };
      }

      // Kanban DONE column: drop the IN_PROGRESS_TAG exclusion so a completed
      // task that still carries the tag actually lands here.
      if (
        board.id === 'KANBAN_DEFAULT' &&
        panel.id === 'DONE' &&
        panel.excludedTagIds?.includes(IN_PROGRESS_TAG.id)
      ) {
        boardChanged = true;
        return {
          ...panel,
          excludedTagIds: panel.excludedTagIds.filter((id) => id !== IN_PROGRESS_TAG.id),
        };
      }

      return panel;
    });

    if (boardChanged) {
      changed = true;
      return { ...board, panels };
    }
    return board;
  });

  return changed ? { ...boardsState, boardCfgs } : boardsState;
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
      ? sanitizeBoardsState(
          fixBuggyDefaultBoardFilters(deduplicatePanelIds(appDataComplete.boards)),
        )
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

  on(BoardsActions.sortBoards, (state, { ids }) => {
    const byId = new Map(state.boardCfgs.map((b) => [b.id, b]));
    const ordered = ids.map((id) => byId.get(id)).filter((b): b is BoardCfg => !!b);
    const seen = new Set(ids);
    // Preserve boards missing from `ids` (e.g. stale dispatch from another client).
    const tail = state.boardCfgs.filter((b) => !seen.has(b.id));
    return { ...state, boardCfgs: [...ordered, ...tail] };
  }),

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
