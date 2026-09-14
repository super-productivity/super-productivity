import { getWidgetValidUntil, selectAndroidWidgetData } from './android-widget.selectors';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { Task } from '../../tasks/task.model';
import { Project } from '../../project/project.model';

describe('getWidgetValidUntil', () => {
  const HOUR = 60 * 60 * 1000;
  const FOUR_HOURS = 4 * HOUR;

  it('should return local midnight after the given day', () => {
    // built the same way the impl does, so the expectation holds in every TZ the
    // suite runs under rather than pinning one zone's epoch
    expect(getWidgetValidUntil('2026-07-17', 0)).toBe(new Date(2026, 6, 18).getTime());
  });

  it('should push the boundary out by the start-of-next-day offset', () => {
    // 4am start-of-next-day: the 17th's snapshot stays valid until 04:00 on the 18th
    expect(getWidgetValidUntil('2026-07-17', FOUR_HOURS)).toBe(
      new Date(2026, 6, 18).getTime() + FOUR_HOURS,
    );
  });

  it('should roll over month and year boundaries', () => {
    expect(getWidgetValidUntil('2026-07-31', 0)).toBe(new Date(2026, 7, 1).getTime());
    expect(getWidgetValidUntil('2026-12-31', 0)).toBe(new Date(2027, 0, 1).getTime());
    expect(getWidgetValidUntil('2028-02-28', 0)).toBe(new Date(2028, 1, 29).getTime());
  });

  // Both transitions for each TZ the suite runs under (Berlin, then Los_Angeles), so
  // neither variant passes these vacuously.
  const DST_DAYS = ['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01'];

  // THE property, and the reason native needs no calendar rules of its own: validUntil
  // is exactly the instant the app's own logical day rolls over. Asserted against the
  // REAL getDbDateStr — a copy would keep passing if the app's day rule ever changed,
  // which is precisely the drift this test exists to catch.
  //
  // Deliberately not asserting "validUntil is local midnight": that is true in Berlin
  // and Los_Angeles but false for correct code in zones where midnight does not exist
  // (America/Santiago resolves it to 01:00). The rollover property holds everywhere.
  it('should mark exactly the instant the logical day changes', () => {
    const logicalToday = (nowMs: number, offset: number): string =>
      getDbDateStr(new Date(nowMs - offset));

    for (const dayStr of ['2026-07-17', '2026-03-28', ...DST_DAYS]) {
      for (const offset of [0, FOUR_HOURS]) {
        const validUntil = getWidgetValidUntil(dayStr, offset);
        expect(logicalToday(validUntil - 1, offset)).toBe(dayStr);
        expect(logicalToday(validUntil, offset)).not.toBe(dayStr);
      }
    }
  });
});

describe('selectAndroidWidgetData', () => {
  const DAY = '2026-07-17';
  const VALID_UNTIL = new Date(2026, 6, 18).getTime();

  const task = (id: string, partial: Partial<Task> = {}): Task =>
    ({
      id,
      title: `Task ${id}`,
      isDone: false,
      projectId: undefined,
      ...partial,
    }) as Task;

  const project = (
    id: string,
    primary?: string,
    taskIds: string[] = [],
    backlogTaskIds: string[] = [],
  ): Project =>
    ({
      id,
      title: `Project ${id}`,
      theme: primary ? { primary } : {},
      taskIds,
      backlogTaskIds,
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
      [project('p1', '#ff0000')],
      DAY,
      0,
    );
    expect(result).toEqual({
      v: 1,
      dayStr: DAY,
      validUntil: VALID_UNTIL,
      tasks: [
        { id: 't1', title: 'Task one', isDone: false, projectId: 'p1' },
        { id: 't2', title: 'Task two', isDone: true },
      ],
      projectColors: { p1: '#ff0000' },
      projects: [{ id: 'p1', title: 'Project p1', tasks: [] }],
    });
  });

  it('should skip today ids without a task entity', () => {
    const result = selectAndroidWidgetData.projector(
      ['missing', 't1'],
      { t1: task('t1') },
      projectState([]),
      [],
      DAY,
      0,
    );
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].id).toBe('t1');
  });

  it('should omit projectId key entirely for project-less tasks (JSON null breaks the Kotlin parser contract)', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { projectId: undefined }) },
      projectState([]),
      [],
      DAY,
      0,
    );
    expect('projectId' in result.tasks[0]).toBe(false);
  });

  it('should serialize a completed task timestamp for native project-widget expiry', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { isDone: true, doneOn: 123 }) },
      projectState([]),
      [],
      DAY,
      0,
    );

    expect(result.tasks[0].doneOn).toBe(123);
  });

  it('should not include colors for projects without a theme primary', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { projectId: 'p1' }) },
      projectState([project('p1')]),
      [project('p1')],
      DAY,
      0,
    );
    expect(result.projectColors).toEqual({});
    expect(result.tasks[0].projectId).toBe('p1');
  });

  // Native judges staleness purely by `now >= validUntil`, so the boundary — not the
  // raw offset — is what has to cross the wire. dayStr rides along for the label only.
  it('should stamp the boundary including a custom start-of-next-day', () => {
    const fourAmOffset = 4 * 60 * 60 * 1000;
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1') },
      projectState([]),
      [],
      '2026-07-16',
      fourAmOffset,
    );
    expect(result.dayStr).toBe('2026-07-16');
    expect(result.validUntil).toBe(new Date(2026, 6, 17).getTime() + fourAmOffset);
  });

  it('should serialize to the exact v:1 blob shape consumed by WidgetData.kt (see WidgetDataTest.kt)', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1', 't2'],
      {
        t1: task('t1', { title: 'Task one', projectId: 'p1' }),
        t2: task('t2', { title: 'Task two', isDone: true }),
      },
      projectState([project('p1', '#ff0000')]),
      [project('p1', '#ff0000')],
      DAY,
      0,
    );
    expect(JSON.stringify(result)).toBe(
      `{"v":1,"dayStr":"${DAY}","validUntil":${VALID_UNTIL},"tasks":[` +
        '{"id":"t1","title":"Task one","isDone":false,"projectId":"p1"},' +
        '{"id":"t2","title":"Task two","isDone":true}],' +
        '"projectColors":{"p1":"#ff0000"},' +
        '"projects":[{"id":"p1","title":"Project p1","tasks":[]}]}',
    );
  });

  it('should project each selectable project in its stored task order', () => {
    const work = project('work', '#ff0000', ['t2', 'missing', 't1']);
    const result = selectAndroidWidgetData.projector(
      [],
      {
        t1: task('t1', { title: 'First', projectId: 'work' }),
        t2: task('t2', {
          title: 'Second',
          projectId: 'work',
          isDone: true,
          doneOn: 123,
        }),
      },
      projectState([work]),
      [work],
      DAY,
      0,
    );

    expect(result.projects).toEqual([
      {
        id: 'work',
        title: 'Project work',
        tasks: [
          { id: 't2', title: 'Second', isDone: true, doneOn: 123, projectId: 'work' },
          { id: 't1', title: 'First', isDone: false, projectId: 'work' },
        ],
      },
    ]);
  });

  it('should cap each project list at the native widget row limit', () => {
    const taskIds = Array.from({ length: 21 }, (_, index) => `t${index + 1}`);
    const largeProject = project('large', undefined, taskIds);
    const result = selectAndroidWidgetData.projector(
      [],
      Object.fromEntries(taskIds.map((id) => [id, task(id, { projectId: 'large' })])),
      projectState([largeProject]),
      [largeProject],
      DAY,
      0,
    );

    expect(result.projects[0].tasks.length).toBe(20);
    expect(result.projects[0].tasks[19].id).toBe('t20');
  });

  it('should append backlog tasks after regular project tasks', () => {
    const work = project('work', undefined, ['t1'], ['t2']);
    const result = selectAndroidWidgetData.projector(
      [],
      {
        t1: task('t1', { projectId: 'work' }),
        t2: task('t2', { projectId: 'work' }),
      },
      projectState([work]),
      [work],
      DAY,
      0,
    );

    expect(result.projects[0].tasks.map((widgetTask) => widgetTask.id)).toEqual([
      't1',
      't2',
    ]);
  });
});
