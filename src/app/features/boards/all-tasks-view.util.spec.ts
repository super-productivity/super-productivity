import { createAllTasksList, isAllTasksList } from './all-tasks-view.util';
import { DEFAULT_BOARDS, DEFAULT_PANEL_CFG } from './boards.const';
import { BoardCfg, BoardPanelCfg, BoardPanelCfgTaskDoneState } from './boards.model';
import { matchPanelTasks, panelToCriteria } from './boards.util';
import { createTaskCriteriaCtx } from '../tasks/task-criteria/task-criteria';
import { DEFAULT_TASK, TaskCopy } from '../tasks/task.model';
import { INBOX_PROJECT } from '../project/project.const';

const list = (panel: Partial<BoardPanelCfg> = {}, cols = 1): BoardCfg => ({
  id: 'b',
  title: 'Mine',
  cols,
  panels: [{ ...DEFAULT_PANEL_CFG, id: 'p', ...panel }],
});

describe('isAllTasksList', () => {
  it('is a single list without rules, whatever its title', () => {
    expect(isAllTasksList(list())).toBe(true);
  });

  it('is a single list of tasks that are not completed', () => {
    expect(
      isAllTasksList(list({ taskDoneState: BoardPanelCfgTaskDoneState.UnDone })),
    ).toBe(true);
  });

  it('is not a list narrowed by another rule', () => {
    expect(isAllTasksList(list({ projectIds: ['projectA'] }))).toBe(false);
    expect(isAllTasksList(list({ includedTagIds: ['tagA'] }))).toBe(false);
    expect(isAllTasksList(list({ taskDoneState: BoardPanelCfgTaskDoneState.Done }))).toBe(
      false,
    );
  });

  it('is not a board, nor a list with several sections', () => {
    expect(isAllTasksList(list({}, 2))).toBe(false);
    const twoSections = list();
    expect(
      isAllTasksList({
        ...twoSections,
        panels: [...twoSections.panels, { ...DEFAULT_PANEL_CFG, id: 'p2' }],
      }),
    ).toBe(false);
  });

  it('is none of the default views', () => {
    expect(DEFAULT_BOARDS.filter(isAllTasksList)).toEqual([]);
  });
});

describe('createAllTasksList', () => {
  const task = (id: string, fields: Partial<TaskCopy> = {}): TaskCopy => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: INBOX_PROJECT.id,
    ...fields,
  });

  it('creates a titled list that counts as the all-tasks list', () => {
    const board = createAllTasksList('All tasks');
    expect(board.title).toBe('All tasks');
    expect(board.cols).toBe(1);
    expect(board.panels.length).toBe(1);
    expect(board.panels[0].title).toBe('All tasks');
    expect(board.id).not.toBe(board.panels[0].id);
    expect(isAllTasksList(board)).toBe(true);
  });

  it('gives every view its own ids', () => {
    const a = createAllTasksList('All tasks');
    const b = createAllTasksList('All tasks');
    expect(a.id).not.toBe(b.id);
    expect(a.panels[0].id).not.toBe(b.panels[0].id);
  });

  it('matches open tasks of every project and none that are done', () => {
    const tasks = [
      task('inbox'),
      task('projectA', { projectId: 'A' }),
      task('projectB', { projectId: 'B', dueDay: '2026-11-28' }),
      task('inBacklog', { projectId: 'A' }),
      task('done', { projectId: 'A', isDone: true }),
    ];
    const ctx = createTaskCriteriaCtx({
      todayStr: '2026-11-27',
      startOfNextDayDiffMs: 0,
      firstDayOfWeek: 1,
      isInBacklog: (t) => t.id === 'inBacklog',
    });
    const [panel] = createAllTasksList('All tasks').panels;
    expect(matchPanelTasks(tasks, panelToCriteria(panel), ctx).map((t) => t.id)).toEqual([
      'inbox',
      'projectA',
      'projectB',
      'inBacklog',
    ]);
  });
});
