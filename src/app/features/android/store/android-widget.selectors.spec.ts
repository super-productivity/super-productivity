import {
  buildLocalCurrentTask,
  getWidgetValidUntil,
  resolveRemoteCurrentTask,
  selectAndroidWidgetData,
} from './android-widget.selectors';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { Task } from '../../tasks/task.model';
import { Project } from '../../project/project.model';
import {
  PRESENCE_STALE_AFTER_MS,
  RemoteSessionView,
} from '../../tracking-presence/tracking-presence.model';
import { getDeviceLabel } from '../../tracking-presence/get-device-label.util';
import { selectLaterTodayStructure } from '../../tasks/store/task.selectors';
import { Section } from '../../section/section.model';
import { TODAY_TAG } from '../../tag/tag.const';
import { WorkContextType } from '../../work-context/work-context.model';

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
      [],
      DAY,
      0,
      null,
      [],
      new Map(),
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
      currentTask: null,
      projects: [],
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
      null,
      [],
      new Map(),
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
      null,
      [],
      new Map(),
    );
    expect('projectId' in result.tasks[0]).toBe(false);
  });

  it('should not include colors for projects without a theme primary', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { projectId: 'p1' }) },
      projectState([project('p1')]),
      [],
      DAY,
      0,
      null,
      [],
      new Map(),
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
      null,
      [],
      new Map(),
    );
    expect(result.dayStr).toBe('2026-07-16');
    expect(result.validUntil).toBe(new Date(2026, 6, 17).getTime() + fourAmOffset);
  });

  it('should include the local device currentTask when a task is being tracked', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { title: 'Task one', projectId: 'p1' }) },
      projectState([project('p1', '#ff0000')]),
      [],
      DAY,
      0,
      't1',
      [],
      new Map(),
    );
    expect(result.currentTask).toEqual({
      id: 't1',
      title: 'Task one',
      projectId: 'p1',
      deviceLabel: getDeviceLabel(),
      isLocal: true,
    });
  });

  it('should serialize to the exact v:1 blob shape consumed by WidgetData.kt (see WidgetDataTest.kt)', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1', 't2'],
      {
        t1: task('t1', { title: 'Task one', projectId: 'p1' }),
        t2: task('t2', { title: 'Task two', isDone: true }),
      },
      projectState([project('p1', '#ff0000')]),
      [],
      DAY,
      0,
      null,
      [],
      new Map(),
    );
    expect(JSON.stringify(result)).toBe(
      `{"v":1,"dayStr":"${DAY}","validUntil":${VALID_UNTIL},"tasks":[` +
        '{"id":"t1","title":"Task one","isDone":false,"projectId":"p1"},' +
        '{"id":"t2","title":"Task two","isDone":true}],' +
        '"projectColors":{"p1":"#ff0000"},"currentTask":null,"projects":[]}',
    );
  });

  // #9518: a widget instance can show one project instead of Today.
  describe('projects (#9518)', () => {
    const projectsFor = (
      projects: Project[],
      tasks: Task[],
    ): ReturnType<typeof selectAndroidWidgetData.projector>['projects'] =>
      selectAndroidWidgetData.projector(
        [],
        Object.fromEntries(tasks.map((t) => [t.id, t])),
        projectState(projects),
        projects,
        DAY,
        0,
        null,
        [],
        new Map(),
      ).projects;

    it('should list each selectable project with its open tasks in stored order', () => {
      const work = project('work', '#ff0000', ['t2', 'missing', 't1']);
      expect(
        projectsFor(
          [work],
          [
            task('t1', { title: 'First', projectId: 'work' }),
            task('t2', { title: 'Second', projectId: 'work' }),
          ],
        ),
      ).toEqual([
        {
          id: 'work',
          title: 'Project work',
          tasks: [
            { id: 't2', title: 'Second', isDone: false, projectId: 'work' },
            { id: 't1', title: 'First', isDone: false, projectId: 'work' },
          ],
        },
      ]);
    });

    it('should leave out done tasks', () => {
      const work = project('work', undefined, ['t1', 't2']);
      const result = projectsFor(
        [work],
        [
          task('t1', { projectId: 'work', isDone: true, doneOn: 1 }),
          task('t2', { projectId: 'work' }),
        ],
      );
      expect(result[0].tasks.map((t) => t.id)).toEqual(['t2']);
    });

    // Done tasks stay in project.taskIds until archived, so a rarely visited
    // project can lead with many of them; they must not use up the rows.
    it('should fill 20 rows with open tasks past 20 leading done ones', () => {
      const taskIds = Array.from({ length: 45 }, (_, i) => `t${i + 1}`);
      const large = project('large', undefined, taskIds);
      const result = projectsFor(
        [large],
        taskIds.map((id, i) => task(id, { projectId: 'large', isDone: i < 20 })),
      );
      expect(result[0].tasks.map((t) => t.id)).toEqual(
        Array.from({ length: 20 }, (_, i) => `t${i + 21}`),
      );
    });

    it('should append backlog tasks after regular project tasks', () => {
      const work = project('work', undefined, ['t1'], ['t2']);
      const result = projectsFor(
        [work],
        [task('t1', { projectId: 'work' }), task('t2', { projectId: 'work' })],
      );
      expect(result[0].tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    });

    it('should add the colors of project tasks to projectColors', () => {
      const work = project('work', '#00ff00', ['t1']);
      const result = selectAndroidWidgetData.projector(
        [],
        { t1: task('t1', { projectId: 'work' }) },
        projectState([work]),
        [work],
        DAY,
        0,
        null,
        [],
        new Map(),
      );
      expect(result.projectColors).toEqual({ work: '#00ff00' });
    });
  });

  // #11109: the widget must list today's tasks in the order the Today screen shows
  // them — main list, then the "Later Today" panel (by start time), then done —
  // not in the raw stored order.
  describe('order (#11109)', () => {
    const at = (hours: number): number => new Date(2026, 6, 17, hours).getTime();

    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 6, 17, 9));
    });
    afterEach(() => jasmine.clock().uninstall());

    // The Later Today panel's real source, so the widget is checked against the
    // order the screen actually renders, not against a hand-written stub.
    const laterTodayStructureFor = (
      tasks: Task[],
      currentTaskId: string | null,
    ): ReturnType<typeof selectLaterTodayStructure.projector> =>
      selectLaterTodayStructure.projector(
        tasks.map((t) => ({
          id: t.id,
          isDone: t.isDone,
          dueDay: t.dueDay ?? null,
          dueWithTime: t.dueWithTime ?? null,
          deadlineDay: null,
          deadlineWithTime: null,
          parentId: t.parentId ?? null,
          subTaskIds: t.subTaskIds,
        })),
        DAY,
        0,
        currentTaskId,
      );

    const widgetOrder = (
      storedOrder: string[],
      tasks: Task[],
      currentTaskId: string | null = null,
      todaySections: Section[] = [],
    ): string[] =>
      selectAndroidWidgetData
        .projector(
          storedOrder,
          Object.fromEntries(tasks.map((t) => [t.id, t])),
          projectState([]),
          [],
          DAY,
          0,
          currentTaskId,
          laterTodayStructureFor(tasks, currentTaskId),
          new Map([[TODAY_TAG.id, todaySections]]),
        )
        .tasks.map((t) => t.id);

    const sched = (id: string, partial: Partial<Task>): Task =>
      task(id, { subTaskIds: [], dueDay: DAY, ...partial });

    it('should list the main list first, then upcoming tasks by start time, then done', () => {
      const tasks = [
        sched('B', { dueDay: undefined, dueWithTime: at(15) }),
        sched('A', { dueDay: undefined, dueWithTime: at(11) }),
        sched('C', {}),
        sched('D', { isDone: true, doneOn: at(8) }),
      ];
      expect(widgetOrder(['B', 'A', 'C', 'D'], tasks)).toEqual(['C', 'A', 'B', 'D']);
    });

    it('should keep an appointment that already started in its stored main-list place', () => {
      const tasks = [
        sched('B', { dueDay: undefined, dueWithTime: at(15) }),
        sched('P', { dueDay: undefined, dueWithTime: at(8) }),
        sched('C', {}),
      ];
      expect(widgetOrder(['B', 'P', 'C'], tasks)).toEqual(['P', 'C', 'B']);
    });

    it('should keep the tracked task in the main list even if it starts later', () => {
      const tasks = [
        sched('B', { dueDay: undefined, dueWithTime: at(15) }),
        sched('C', {}),
      ];
      expect(widgetOrder(['B', 'C'], tasks, 'B')).toEqual(['B', 'C']);
    });

    // The screen lists such a parent in both its main-list place and the panel;
    // the widget has one row per task and keeps the manual main-list place.
    it('should keep a parent that is upcoming only through a subtask in its main-list place', () => {
      const tasks = [
        sched('P', { subTaskIds: ['S'] }),
        sched('S', { dueDay: undefined, dueWithTime: at(14), parentId: 'P' }),
        sched('C', {}),
      ];
      expect(widgetOrder(['P', 'C'], tasks)).toEqual(['P', 'C']);
    });

    it('should keep a parent whose own start passed in its main-list place despite an upcoming subtask', () => {
      const tasks = [
        sched('P', { dueDay: undefined, dueWithTime: at(8), subTaskIds: ['S'] }),
        sched('S', { dueDay: undefined, dueWithTime: at(14), parentId: 'P' }),
        sched('C', {}),
      ];
      expect(widgetOrder(['P', 'C'], tasks)).toEqual(['P', 'C']);
    });

    it('should list unsectioned tasks first, then each Today section in its own order', () => {
      const tasks = [
        sched('X1', {}),
        sched('N', {}),
        sched('X2', {}),
        sched('L', { dueDay: undefined, dueWithTime: at(11) }),
      ];
      const section = {
        id: 'sec',
        contextId: TODAY_TAG.id,
        contextType: WorkContextType.TAG,
        title: 'Section',
        // the section holds an upcoming task too; it stays in the later block
        taskIds: ['X2', 'L', 'X1'],
      };
      expect(widgetOrder(['X1', 'N', 'X2', 'L'], tasks, null, [section])).toEqual([
        'N',
        'X2',
        'X1',
        'L',
      ]);
    });

    it('should move an upcoming subtask whose parent is not in Today to the later block', () => {
      const tasks = [
        sched('X', { dueDay: '2026-07-20', subTaskIds: ['S'] }),
        sched('S', { dueDay: undefined, dueWithTime: at(11), parentId: 'X' }),
        sched('C', {}),
      ];
      expect(widgetOrder(['S', 'C'], tasks)).toEqual(['C', 'S']);
    });

    // The panel structure is memoized with the clock of its last recompute, so it
    // can still list an appointment that has started since; the widget must
    // re-check the start against its own clock, as the work view does.
    it('should return a task the stale panel still lists to the main list once it started', () => {
      const tasks = [
        sched('B', {
          dueDay: undefined,
          dueWithTime: new Date(2026, 6, 17, 9, 30).getTime(),
        }),
        sched('C', {}),
      ];
      const staleStructure = laterTodayStructureFor(tasks, null);
      jasmine.clock().mockDate(new Date(2026, 6, 17, 10));
      const result = selectAndroidWidgetData.projector(
        ['B', 'C'],
        Object.fromEntries(tasks.map((t) => [t.id, t])),
        projectState([]),
        [],
        DAY,
        0,
        null,
        staleStructure,
        new Map(),
      );
      expect(staleStructure.map((e) => e.id)).toEqual(['B']);
      expect(result.tasks.map((t) => t.id)).toEqual(['B', 'C']);
    });

    it('should list done tasks newest-first like the Done list', () => {
      const tasks = [
        sched('D1', { isDone: true, doneOn: at(7) }),
        sched('C', {}),
        sched('D2', { isDone: true, doneOn: at(8) }),
      ];
      expect(widgetOrder(['D1', 'C', 'D2'], tasks)).toEqual(['C', 'D2', 'D1']);
    });
  });
});

describe('buildLocalCurrentTask', () => {
  const task = (id: string, partial: Partial<Task> = {}): Task =>
    ({
      id,
      title: `Task ${id}`,
      isDone: false,
      projectId: undefined,
      ...partial,
    }) as Task;

  it('should return null when nothing is tracked locally', () => {
    expect(buildLocalCurrentTask(null, {})).toBeNull();
  });

  it('should return null when the tracked id has no matching task entity', () => {
    expect(buildLocalCurrentTask('missing', {})).toBeNull();
  });

  it('should build the current task with the device label and isLocal true', () => {
    const result = buildLocalCurrentTask('t1', { t1: task('t1', { title: 'Write' }) });
    expect(result).toEqual({
      id: 't1',
      title: 'Write',
      deviceLabel: getDeviceLabel(),
      isLocal: true,
    });
  });

  it('should include projectId only when set', () => {
    const result = buildLocalCurrentTask('t1', {
      t1: task('t1', { projectId: 'p1' }),
    });
    expect(result?.projectId).toBe('p1');
  });
});

describe('resolveRemoteCurrentTask', () => {
  const task = (id: string, partial: Partial<Task> = {}): Task =>
    ({
      id,
      title: `Task ${id}`,
      isDone: false,
      projectId: undefined,
      ...partial,
    }) as Task;

  const view = (partial: {
    isStale?: boolean;
    state?: 'tracking' | 'stopped';
    taskId?: string | null;
    deviceLabel?: string;
  }): RemoteSessionView =>
    ({
      isStale: partial.isStale ?? false,
      session: {
        receivedAt: 1_000,
        payload: {
          state: partial.state ?? 'tracking',
          taskId: partial.taskId ?? 't1',
          deviceLabel: partial.deviceLabel ?? 'Desktop',
        },
      },
    }) as RemoteSessionView;

  it('should return null when there is no remote session', () => {
    expect(resolveRemoteCurrentTask(null, {})).toBeNull();
  });

  it('should return null when the remote session is stale', () => {
    expect(
      resolveRemoteCurrentTask(view({ isStale: true }), { t1: task('t1') }),
    ).toBeNull();
  });

  it('should return null when the remote device is not actively tracking', () => {
    expect(
      resolveRemoteCurrentTask(view({ state: 'stopped' }), { t1: task('t1') }),
    ).toBeNull();
  });

  it('should return null when the remote task is not known locally', () => {
    expect(resolveRemoteCurrentTask(view({}), {})).toBeNull();
  });

  it('should resolve the remote task with its device label and isLocal false', () => {
    const result = resolveRemoteCurrentTask(view({ deviceLabel: 'Desktop' }), {
      t1: task('t1', { title: 'Write report' }),
    });
    expect(result).toEqual({
      id: 't1',
      title: 'Write report',
      deviceLabel: 'Desktop',
      isLocal: false,
      expiresAt: 1_000 + PRESENCE_STALE_AFTER_MS,
    });
  });
});
