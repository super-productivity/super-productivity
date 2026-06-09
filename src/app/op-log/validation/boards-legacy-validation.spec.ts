import { validateAppDataProperty } from './validation-fn';
import { BoardsState } from '../../features/boards/store/boards.reducer';
import { BoardCfg, BoardPanelCfg } from '../../features/boards/boards.model';

/**
 * Regression guard for the `projectId` → `projectIds` schema migration (#8069).
 *
 * `projectIds` MUST stay optional on the synced `BoardSrcCfg`. Several raw-data
 * paths run the typia validator BEFORE the boards reducer's `sanitizePanelCfg`
 * normalizes the shape — most notably the one-time legacy PFAPI → op-log
 * migration, which re-validates after repair and THROWS on failure (and
 * `data-repair.ts` has no boards handling). If `projectIds` were required,
 * every legacy panel (which carries `projectId` and no `projectIds`) would fail
 * validation and abort that migration for existing users.
 */
describe('boards typia validation — legacy projectId compatibility', () => {
  const makeBoard = (panel: BoardPanelCfg): BoardsState => ({
    boardCfgs: [
      {
        id: 'board1',
        title: 'Board',
        cols: 3,
        panels: [panel],
      } as BoardCfg,
    ],
  });

  const basePanel: Omit<BoardPanelCfg, 'projectIds'> = {
    id: 'panel1',
    title: 'Panel',
    taskIds: [],
    includedTagIds: [],
    excludedTagIds: [],
    taskDoneState: 1,
    scheduledState: 1,
    isParentTasksOnly: false,
  };

  it('accepts a legacy panel that has `projectId` but no `projectIds`', () => {
    // The exact shape produced by an old client (or pre-upgrade IndexedDB).
    const legacyPanel = {
      ...basePanel,
      projectId: 'p1',
    } as BoardPanelCfg & { projectId?: string };

    const result = validateAppDataProperty('boards', makeBoard(legacyPanel));
    expect(result.success).toBe(true);
  });

  it('accepts a panel with no project field at all', () => {
    const result = validateAppDataProperty(
      'boards',
      makeBoard(basePanel as BoardPanelCfg),
    );
    expect(result.success).toBe(true);
  });

  it('accepts the new multi-project shape', () => {
    const result = validateAppDataProperty(
      'boards',
      makeBoard({ ...basePanel, projectIds: ['', 'p1'] } as BoardPanelCfg),
    );
    expect(result.success).toBe(true);
  });

  it('still rejects a wrongly-typed `projectIds` (validation stays active when present)', () => {
    const result = validateAppDataProperty(
      'boards',
      makeBoard({ ...basePanel, projectIds: [123] } as unknown as BoardPanelCfg),
    );
    expect(result.success).toBe(false);
  });
});
