import { DEFAULT_BOARDS } from './boards.const';
import { getPanelItems, matchPanelTasks, panelToCriteria } from './boards.util';
import { createTaskCriteriaCtx } from '../tasks/task-criteria/task-criteria';
import { DEFAULT_TASK, TaskCopy } from '../tasks/task.model';
import { INBOX_PROJECT } from '../project/project.const';

const task = (id: string, partial: Partial<TaskCopy> = {}): TaskCopy => ({
  ...DEFAULT_TASK,
  id,
  title: id,
  projectId: INBOX_PROJECT.id,
  ...partial,
});

describe('DEFAULT_BOARDS', () => {
  it('should open on a single list of all tasks', () => {
    const [first] = DEFAULT_BOARDS;

    expect(first.id).toBe('ALL_TASKS');
    // one column or less is the list layout
    expect(first.cols).toBe(1);
    // a single section shows no header, so the view reads as one list
    expect(first.panels.length).toBe(1);
  });

  it('should give every default view and section an id of its own', () => {
    const ids = DEFAULT_BOARDS.flatMap((board) => [
      board.id,
      ...board.panels.map((panel) => panel.id),
    ]);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should list the open tasks of every project as rows in "All tasks"', () => {
    const [panel] = DEFAULT_BOARDS[0].panels;
    const tasks = [
      task('inbox'),
      task('projectA', { projectId: 'A' }),
      task('projectB', { projectId: 'B', tagIds: ['someTag'] }),
      task('plannedForDay', { projectId: 'A', dueDay: '2026-12-01' }),
      task('plannedWithTime', { projectId: 'B', dueWithTime: 1795000000000 }),
      task('inBacklog', { projectId: 'A' }),
      task('done', { projectId: 'A', isDone: true }),
      task('subTask', { projectId: 'A', parentId: 'projectA' }),
      task('openSubTaskOfDone', { projectId: 'A', parentId: 'done' }),
    ];
    const ctx = createTaskCriteriaCtx({
      todayStr: '2026-11-27',
      startOfNextDayDiffMs: 0,
      firstDayOfWeek: 1,
      isInBacklog: (t) => t.id === 'inBacklog',
    });

    const matching = matchPanelTasks(tasks, panelToCriteria(panel), ctx);
    const rows = getPanelItems(matching, panel, true);

    // 'subTask' shows inside the 'projectA' row
    expect(rows.main.map((t) => t.id)).toEqual([
      'inbox',
      'projectA',
      'projectB',
      'plannedForDay',
      'plannedWithTime',
      'inBacklog',
      'openSubTaskOfDone',
    ]);
    expect(rows.done).toEqual([]);
  });
});
