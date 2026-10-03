import {
  buildLocalCurrentTask,
  getWidgetValidUntil,
  resolveRemoteCurrentTask,
  selectAndroidWidgetData,
} from './android-widget.selectors';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { Task } from '../../tasks/task.model';
import { Project } from '../../project/project.model';
import { RemoteSessionView } from '../../tracking-presence/tracking-presence.model';
import { getDeviceLabel } from '../../tracking-presence/get-device-label.util';

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
      DAY,
      0,
      null,
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
    });
  });

  it('should skip today ids without a task entity', () => {
    const result = selectAndroidWidgetData.projector(
      ['missing', 't1'],
      { t1: task('t1') },
      projectState([]),
      DAY,
      0,
      null,
    );
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].id).toBe('t1');
  });

  it('should omit projectId key entirely for project-less tasks (JSON null breaks the Kotlin parser contract)', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { projectId: undefined }) },
      projectState([]),
      DAY,
      0,
      null,
    );
    expect('projectId' in result.tasks[0]).toBe(false);
  });

  it('should not include colors for projects without a theme primary', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { projectId: 'p1' }) },
      projectState([project('p1')]),
      DAY,
      0,
      null,
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
      '2026-07-16',
      fourAmOffset,
      null,
    );
    expect(result.dayStr).toBe('2026-07-16');
    expect(result.validUntil).toBe(new Date(2026, 6, 17).getTime() + fourAmOffset);
  });

  it('should include the local device currentTask when a task is being tracked', () => {
    const result = selectAndroidWidgetData.projector(
      ['t1'],
      { t1: task('t1', { title: 'Task one', projectId: 'p1' }) },
      projectState([project('p1', '#ff0000')]),
      DAY,
      0,
      't1',
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
      DAY,
      0,
      null,
    );
    expect(JSON.stringify(result)).toBe(
      `{"v":1,"dayStr":"${DAY}","validUntil":${VALID_UNTIL},"tasks":[` +
        '{"id":"t1","title":"Task one","isDone":false,"projectId":"p1"},' +
        '{"id":"t2","title":"Task two","isDone":true}],' +
        '"projectColors":{"p1":"#ff0000"},"currentTask":null}',
    );
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
    });
  });
});
