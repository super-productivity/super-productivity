import { selectAndroidWidgetData } from './android-widget.selectors';
import { Task } from '../../tasks/task.model';
import { Project } from '../../project/project.model';

describe('selectAndroidWidgetData', () => {
  const task = (id: string, partial: Partial<Task> = {}): Task =>
    ({
      id,
      title: `Task ${id}`,
      isDone: false,
      projectId: undefined,
      ...partial,
    }) as Task;

  const project = (id: string, primary?: string): Project =>
    ({
      id,
      title: `Project ${id}`,
      theme: primary ? { primary } : {},
    }) as Project;

  const projectState = (projects: Project[]): any => ({
    ids: projects.map((p) => p.id),
    entities: Object.fromEntries(projects.map((p) => [p.id, p])),
  });

  it('should project today tasks in order with project colors', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1', 't2'],
      {
        t1: task('t1', { title: 'Task one', projectId: 'p1' }),
        t2: task('t2', { title: 'Task two', isDone: true }),
      },
      projectState([project('p1', '#ff0000')]),
    );
    expect(result).toEqual({
      v: 1,
      tasks: [
        { id: 't1', title: 'Task one', isDone: false, projectId: 'p1' },
        { id: 't2', title: 'Task two', isDone: true },
      ],
      projectColors: { p1: '#ff0000' },
    });
  });

  it('should skip today ids without a task entity', () => {
    const result = selectAndroidWidgetData.projector(
      ['missing', 't1'],
      { t1: task('t1') },
      projectState([]),
    );
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].id).toBe('t1');
  });

  it('should omit projectId key entirely for project-less tasks (JSON null breaks the Kotlin parser contract)', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { projectId: undefined }) },
      projectState([]),
    );
    expect('projectId' in result.tasks[0]).toBe(false);
  });

  it('should not include colors for projects without a theme primary', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { projectId: 'p1' }) },
      projectState([project('p1')]),
    );
    expect(result.projectColors).toEqual({});
    expect(result.tasks[0].projectId).toBe('p1');
  });

  it('should serialize to the exact v:1 blob shape consumed by WidgetData.kt (see WidgetDataTest.kt)', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1', 't2'],
      {
        t1: task('t1', { title: 'Task one', projectId: 'p1' }),
        t2: task('t2', { title: 'Task two', isDone: true }),
      },
      projectState([project('p1', '#ff0000')]),
    );
    expect(JSON.stringify(result)).toBe(
      '{"v":1,"tasks":[' +
        '{"id":"t1","title":"Task one","isDone":false,"projectId":"p1"},' +
        '{"id":"t2","title":"Task two","isDone":true}],' +
        '"projectColors":{"p1":"#ff0000"}}',
    );
  });
});
