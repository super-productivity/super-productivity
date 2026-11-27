import { nanoid } from 'nanoid';
import { BoardCfg, BoardPanelCfgTaskDoneState } from './boards.model';
import { DEFAULT_PANEL_CFG } from './boards.const';
import { getViewLayout, normalizeBoardForSave } from './boards.util';
import { getSetRules } from './view-editor/view-editor.util';

/**
 * Whether a view is one list of every open task: a single section whose only
 * rule, if any, is "not completed". Told by its rules, not by an id or a
 * title: a renamed one still counts, one narrowed by a rule no longer does.
 */
export const isAllTasksList = (board: BoardCfg): boolean => {
  if (getViewLayout(board) !== 'list' || board.panels.length !== 1) {
    return false;
  }
  const [panel] = board.panels;
  return getSetRules(panel).every(
    (rule) =>
      rule === 'done' && panel.taskDoneState === BoardPanelCfgTaskDoneState.UnDone,
  );
};

/**
 * A new list of every open task, as the view editor would save it. `title` is
 * the translated text, not a key: it is stored and synced, and a client
 * without the key would show the key.
 */
export const createAllTasksList = (title: string): BoardCfg =>
  normalizeBoardForSave({
    id: nanoid(),
    title,
    cols: 1,
    panels: [
      {
        ...DEFAULT_PANEL_CFG,
        id: nanoid(),
        // a single-section list hides its section title; it follows the view's
        title,
        taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
      },
    ],
  });
