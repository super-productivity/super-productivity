import { getTaskListWidgetTasks } from './task-list-widget-tasks';
import { DEFAULT_TASK, Task } from './task.model';
import { Project } from '../project/project.model';

describe('getTaskListWidgetTasks', () => {
  const task = (id: string, extra: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: 'p',
    ...extra,
  });
  const projects = [
    { id: 'p', title: 'Project' },
    { id: 'archived', title: 'Old', isArchived: true },
  ] as Project[];

  it('shows open tasks without a running timer and excludes done/archived tasks', () => {
    const result = getTaskListWidgetTasks(
      [
        task('open'),
        task('done', { isDone: true }),
        task('old', { projectId: 'archived' }),
      ],
      projects,
      [],
      'all',
    );
    expect(result.map((t) => t.id)).toEqual(['open']);
  });

  it('uses the canonical Today membership and order, not tagIds', () => {
    const result = getTaskListWidgetTasks(
      [task('a'), task('b'), task('stale', { tagIds: ['TODAY'] })],
      projects,
      ['b', 'missing', 'a'],
      'today',
    );
    expect(result.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('keeps open subtasks under their parent in the parent-defined order', () => {
    const result = getTaskListWidgetTasks(
      [
        task('p1', { subTaskIds: ['c2', 'done', 'missing', 'c1'] }),
        task('c1', { parentId: 'p1' }),
        task('c2', { parentId: 'p1' }),
        task('done', { parentId: 'p1', isDone: true }),
      ],
      projects,
      [],
      'all',
    );
    expect(result.length).toBe(1);
    expect(result[0].subTasks.map((t) => t.id)).toEqual(['c2', 'c1']);
  });

  it('reflects title and estimate edits without leaking notes or tracking ticks', () => {
    const source = task('a', { notes: 'private', timeEstimate: 60000 });
    const original = getTaskListWidgetTasks([source], projects, [], 'all');
    const tick = getTaskListWidgetTasks(
      [{ ...source, timeSpent: 1000 }],
      projects,
      [],
      'all',
    );
    expect(tick).toEqual(original);
    expect(Object.keys(original[0])).not.toContain('notes');
    expect(
      getTaskListWidgetTasks([{ ...source, title: 'Renamed' }], projects, [], 'all')[0]
        .title,
    ).toBe('Renamed');
  });
});
