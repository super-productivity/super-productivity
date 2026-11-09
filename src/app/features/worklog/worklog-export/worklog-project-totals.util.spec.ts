import { DEFAULT_TASK, WorklogTask } from '../../tasks/task.model';
import { getProjectTotals } from './worklog-project-totals.util';

const H = 60 * 60 * 1000;
const D1 = '2026-10-05';
const D2 = '2026-10-06';
const D3 = '2026-10-07';

const task = (
  id: string,
  fields: Pick<WorklogTask, 'projectId' | 'timeSpentOnDay'> &
    Partial<Pick<WorklogTask, 'parentId' | 'subTaskIds'>>,
): WorklogTask => ({
  ...DEFAULT_TASK,
  id,
  title: id,
  dateStr: D1,
  ...fields,
});

const PROJECTS = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
];

describe('getProjectTotals', () => {
  it('should sum the time of all days per project, largest first', () => {
    const result = getProjectTotals(
      [
        task('t1', { projectId: 'b', timeSpentOnDay: { [D1]: H } }),
        task('t2', {
          projectId: 'a',
          timeSpentOnDay: { [D1]: 2 * H, [D2]: H },
        }),
        task('t3', { projectId: 'b', timeSpentOnDay: { [D3]: H } }),
      ],
      PROJECTS,
    );

    expect(result).toEqual([
      { projectId: 'a', title: 'Alpha', timeSpent: 3 * H, share: 0.6 },
      { projectId: 'b', title: 'Beta', timeSpent: 2 * H, share: 0.4 },
    ]);
  });

  it('should count subtasks and not their parent', () => {
    const result = getProjectTotals(
      [
        task('parent', {
          projectId: 'a',
          subTaskIds: ['sub'],
          timeSpentOnDay: { [D1]: H },
        }),
        task('sub', {
          projectId: 'a',
          parentId: 'parent',
          timeSpentOnDay: { [D1]: H },
        }),
      ],
      PROJECTS,
    );

    expect(result).toEqual([{ projectId: 'a', title: 'Alpha', timeSpent: H, share: 1 }]);
  });

  it('should use the parent project for a subtask without one', () => {
    const result = getProjectTotals(
      [
        task('parent', { projectId: 'b', subTaskIds: ['sub'], timeSpentOnDay: {} }),
        task('sub', {
          projectId: '',
          parentId: 'parent',
          timeSpentOnDay: { [D1]: H },
        }),
      ],
      PROJECTS,
    );

    expect(result.map((r) => r.projectId)).toEqual(['b']);
  });

  it('should put tasks without or with an unknown project into one untitled row', () => {
    const result = getProjectTotals(
      [
        task('t1', { projectId: '', timeSpentOnDay: { [D1]: H } }),
        task('t2', { projectId: 'deleted', timeSpentOnDay: { [D1]: H } }),
        task('t3', { projectId: 'a', timeSpentOnDay: { [D1]: 6 * H } }),
      ],
      PROJECTS,
    );

    expect(result).toEqual([
      { projectId: 'a', title: 'Alpha', timeSpent: 6 * H, share: 0.75 },
      { projectId: null, title: undefined, timeSpent: 2 * H, share: 0.25 },
    ]);
  });

  it('should leave out tasks and projects without tracked time', () => {
    const result = getProjectTotals(
      [
        task('t1', { projectId: 'a', timeSpentOnDay: {} }),
        task('t2', { projectId: 'b', timeSpentOnDay: { [D1]: 0 } }),
      ],
      PROJECTS,
    );

    expect(result).toEqual([]);
  });

  it('should order equal totals by title', () => {
    const result = getProjectTotals(
      [
        task('t1', { projectId: 'b', timeSpentOnDay: { [D1]: H } }),
        task('t2', { projectId: 'a', timeSpentOnDay: { [D1]: H } }),
      ],
      PROJECTS,
    );

    expect(result.map((r) => r.title)).toEqual(['Alpha', 'Beta']);
  });
});
