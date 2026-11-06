import { insertBlockedBlocksViewEntriesForSchedule } from './insert-blocked-blocks-view-entries-for-schedule';
import { BlockedBlock, SVE, SVETask } from '../schedule.model';
import { SVEType } from '../schedule.const';
import { TaskCopy } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';

const MIN = 60 * 1000;
const DAY = '2026-10-10';

const taskEntry = (id: string, start: number, duration: number): SVETask => ({
  id,
  type: SVEType.Task,
  start,
  duration,
  data: { id } as TaskCopy,
});

// entries are irrelevant for the flow math; only start/end push tasks around
const block = (start: number, end: number): BlockedBlock => ({ start, end, entries: [] });

// the inserter doesn't keep array order chronological; callers sort afterwards
const byStart = (entries: SVE[]): SVE[] => [...entries].sort((a, b) => a.start - b.start);

const summarize = (entries: SVE[]): { id: string; type: SVEType; start: number }[] =>
  byStart(entries).map((e) => ({
    id: e.id.split('_')[0],
    type: e.type,
    start: e.start / MIN,
  }));

describe('insertBlockedBlocksViewEntriesForSchedule', () => {
  it('should split a task around a block when enough time is left before it', () => {
    const entries: SVE[] = [
      taskEntry('A', 0, 30 * MIN),
      taskEntry('B', 30 * MIN, 10 * MIN),
    ];

    insertBlockedBlocksViewEntriesForSchedule(entries, [block(20 * MIN, 60 * MIN)], DAY);

    expect(summarize(entries)).toEqual([
      { id: 'A', type: SVEType.SplitTask, start: 0 },
      { id: 'A', type: SVEType.SplitTaskContinuedLast, start: 60 },
      { id: 'B', type: SVEType.Task, start: 70 },
    ]);
    expect(byStart(entries)[0].duration).toBe(20 * MIN);
    expect(byStart(entries)[1].duration).toBe(10 * MIN);
  });

  // #10194: as "now" approaches a block, the slice before it shrinks to a few
  // minutes but its card keeps a min height and covers the block
  it('should move a task after the block instead of leaving a tiny slice before it', () => {
    const entries: SVE[] = [
      taskEntry('A', 0, 30 * MIN),
      taskEntry('B', 30 * MIN, 10 * MIN),
    ];

    insertBlockedBlocksViewEntriesForSchedule(entries, [block(3 * MIN, 60 * MIN)], DAY);

    expect(summarize(entries)).toEqual([
      { id: 'A', type: SVEType.Task, start: 60 },
      { id: 'B', type: SVEType.Task, start: 90 },
    ]);
    expect(byStart(entries)[0].duration).toBe(30 * MIN);
  });

  it('should move a continued segment after the block instead of leaving a tiny slice', () => {
    const entries: SVE[] = [
      taskEntry('A', 0, 30 * MIN),
      taskEntry('B', 30 * MIN, 10 * MIN),
    ];

    insertBlockedBlocksViewEntriesForSchedule(
      entries,
      [block(10 * MIN, 20 * MIN), block(22 * MIN, 40 * MIN)],
      DAY,
    );

    expect(summarize(entries)).toEqual([
      { id: 'A', type: SVEType.SplitTask, start: 0 },
      { id: 'A', type: SVEType.SplitTaskContinuedLast, start: 40 },
      { id: 'B', type: SVEType.Task, start: 60 },
    ]);
    expect(byStart(entries)[1].duration).toBe(20 * MIN);
  });

  it('should move a repeat projection after the block instead of leaving a tiny slice', () => {
    const entries: SVE[] = [
      {
        id: 'R_' + DAY,
        type: SVEType.RepeatProjection,
        start: 0,
        duration: 30 * MIN,
        data: { id: 'R' } as TaskRepeatCfg,
        plannedForDay: DAY,
      },
    ];

    insertBlockedBlocksViewEntriesForSchedule(entries, [block(3 * MIN, 60 * MIN)], DAY);

    expect(summarize(entries)).toEqual([
      { id: 'R', type: SVEType.RepeatProjection, start: 60 },
    ]);
    expect(entries[0].duration).toBe(30 * MIN);
  });

  // a task over its estimate has no time left and keeps its slot
  it('should not move a zero-length task that starts with the moved task', () => {
    const entries: SVE[] = [taskEntry('Z', 0, 0), taskEntry('A', 0, 30 * MIN)];

    insertBlockedBlocksViewEntriesForSchedule(entries, [block(3 * MIN, 60 * MIN)], DAY);

    expect(summarize(entries)).toEqual([
      { id: 'Z', type: SVEType.Task, start: 0 },
      { id: 'A', type: SVEType.Task, start: 60 },
    ]);
  });

  it('should not move a short task that ends before the block', () => {
    const entries: SVE[] = [taskEntry('A', 0, 3 * MIN)];

    insertBlockedBlocksViewEntriesForSchedule(entries, [block(5 * MIN, 60 * MIN)], DAY);

    expect(summarize(entries)).toEqual([{ id: 'A', type: SVEType.Task, start: 0 }]);
  });
});
