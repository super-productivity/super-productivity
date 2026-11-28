import { toTrayCell } from './schedule-tray.util';
import { ScheduleDayTray } from '../schedule.model';
import { TaskCopy } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { SVEType } from '../schedule.const';

const M = 60 * 1000;
const H = 60 * M;
const DAY = '2026-01-05';

const fakeTask = (id: string, timeEstimate: number): TaskCopy =>
  ({
    id,
    title: `Task ${id}`,
    subTaskIds: [],
    timeSpent: 0,
    timeEstimate,
  }) as Partial<TaskCopy> as TaskCopy;

const fakeTray = (add: Partial<ScheduleDayTray> = {}): ScheduleDayTray => ({
  tasks: [],
  repeatCfgs: [],
  plannedMs: 0,
  ...add,
});

describe('toTrayCell()', () => {
  it('is empty for a day without a tray', () => {
    expect(toTrayCell(DAY, undefined, 3)).toEqual({
      day: DAY,
      count: 0,
      planned: '',
      free: '',
      over: '',
      chips: [],
      hiddenCount: 0,
    });
  });

  it('shows planned and free time', () => {
    const cell = toTrayCell(
      DAY,
      fakeTray({ tasks: [fakeTask('A', 135 * M)], plannedMs: 135 * M, freeMs: 30 * M }),
      3,
    );
    expect(cell.planned).toBe('2h 15m');
    expect(cell.free).toBe('30m');
    expect(cell.over).toBe('');
  });

  it('shows the overrun instead of free time', () => {
    const cell = toTrayCell(DAY, fakeTray({ plannedMs: 9 * H, freeMs: -150 * M }), 3);
    expect(cell.free).toBe('');
    expect(cell.over).toBe('2h 30m');
  });

  it('shows neither while work hours are off', () => {
    const cell = toTrayCell(DAY, fakeTray({ plannedMs: H }), 3);
    expect(cell.planned).toBe('1h');
    expect(cell.free).toBe('');
    expect(cell.over).toBe('');
  });

  it('shows no planned time when nothing is estimated', () => {
    const cell = toTrayCell(
      DAY,
      fakeTray({ tasks: [fakeTask('A', 0)], plannedMs: 0, freeMs: 7 * H }),
      3,
    );
    expect(cell.planned).toBe('');
    expect(cell.free).toBe('7h');
    expect(cell.chips[0].time).toBe('');
  });

  it('limits the chips and counts the rest', () => {
    const tasks = ['A', 'B', 'C', 'D', 'E'].map((id) => fakeTask(id, H));
    const cell = toTrayCell(DAY, fakeTray({ tasks, plannedMs: 5 * H }), 3);
    expect(cell.count).toBe(5);
    expect(cell.chips.map((chip) => chip.id)).toEqual(['A', 'B', 'C']);
    expect(cell.hiddenCount).toBe(2);
  });

  it('makes a task chip draggable as an event of its day', () => {
    const task = fakeTask('A', 45 * M);
    const chip = toTrayCell(DAY, fakeTray({ tasks: [task] }), 3).chips[0];
    expect(chip.title).toBe('Task A');
    expect(chip.time).toBe('45m');
    expect(chip.dragData).toEqual({
      id: 'A',
      type: SVEType.TaskPlannedForDay,
      style: '',
      startHours: 0,
      timeLeftInHours: 0.75,
      plannedForDay: DAY,
      data: task,
      isInTray: true,
    });
  });

  it('lists a repeating task after the tasks, without anything to drag', () => {
    const cfg = { id: 'R', title: 'Stretch', defaultEstimate: 10 * M } as TaskRepeatCfg;
    const cell = toTrayCell(
      DAY,
      fakeTray({ tasks: [fakeTask('A', H)], repeatCfgs: [cfg] }),
      3,
    );
    expect(cell.chips[1]).toEqual({ id: 'R', title: 'Stretch', time: '10m' });
  });
});
