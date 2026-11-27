import { DEFAULT_TASK, TaskCopy } from '../../tasks/task.model';
import { PlannerActions } from '../store/planner.actions';
import { OVERDUE_LIST_ID } from '../planner.model';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { TODAY_TAG } from '../../tag/tag.const';
import {
  getPlannerGroupDropActions,
  PlannerGroupDrop,
  PlannerGroupSource,
} from './get-planner-group-drop-actions';

describe('getPlannerGroupDropActions', () => {
  const TODAY = '2026-11-09';
  const DAY = '2026-11-12';
  const OTHER = '2026-11-10';
  const task = (id: string, overrides: Partial<TaskCopy> = {}): TaskCopy => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: 'p',
    ...overrides,
  });
  const tasks: Record<string, TaskCopy> = Object.fromEntries(
    ['a', 'b', 'c', 'x', 'y'].map((id) => [id, task(id)]),
  );
  const todo = (day: string): PlannerGroupSource => ({ day, isScheduled: false });
  const drop = (
    overrides: Partial<PlannerGroupDrop>,
  ): ReturnType<typeof getPlannerGroupDropActions> =>
    getPlannerGroupDropActions({
      ids: ['a', 'b'],
      leaderId: 'a',
      orderedIds: [],
      currentIds: [],
      targetDay: DAY,
      todayStr: TODAY,
      sources: new Map(),
      tasks,
      targetDayIds: [],
      ...overrides,
    });
  const transfer = (
    id: string,
    prevDay: string,
    newDay: string,
    targetIndex: number,
  ): ReturnType<typeof PlannerActions.transferTask> =>
    PlannerActions.transferTask({
      task: tasks[id],
      prevDay,
      newDay,
      targetIndex,
      today: TODAY,
    });
  const placeInToday = (
    id: string,
    afterTaskId: string | null,
  ): ReturnType<typeof moveTaskInTodayList> =>
    moveTaskInTodayList({
      taskId: id,
      afterTaskId,
      src: 'UNDONE',
      target: 'UNDONE',
      workContextId: TODAY_TAG.id,
      workContextType: WorkContextType.TAG,
    });

  it('moves a group from other days onto a later day as one block at the slot', () => {
    // a is dropped between x and y; b followed from another day.
    const actions = drop({
      orderedIds: ['x', 'a', 'y'],
      currentIds: ['x', 'y'],
      sources: new Map([
        ['a', todo(OTHER)],
        ['b', todo(TODAY)],
      ]),
      targetDayIds: ['x', 'y'],
    });
    expect(actions).toEqual([transfer('a', OTHER, DAY, 1), transfer('b', TODAY, DAY, 2)]);
  });

  it('reorders a group within its own day, indexing planner.days as each card lands', () => {
    // Day order x a y b; dragging a to the top pulls b up behind it.
    const actions = drop({
      orderedIds: ['a', 'x', 'y', 'b'],
      currentIds: ['x', 'a', 'y', 'b'],
      sources: new Map([
        ['a', todo(DAY)],
        ['b', todo(DAY)],
      ]),
      targetDayIds: ['x', 'a', 'y', 'b'],
    });
    expect(actions).toEqual([transfer('a', DAY, DAY, 0), transfer('b', DAY, DAY, 1)]);
  });

  it('skips a drop that leaves the whole group where it was', () => {
    expect(
      drop({
        orderedIds: ['x', 'a', 'b', 'y'],
        currentIds: ['x', 'a', 'b', 'y'],
        leaderId: 'b',
        sources: new Map([
          ['a', todo(DAY)],
          ['b', todo(DAY)],
        ]),
        targetDayIds: ['x', 'a', 'b', 'y'],
      }),
    ).toEqual([]);
  });

  it('groups separated cards at the stationary leader slot', () => {
    const actions = drop({
      orderedIds: ['a', 'x', 'b'],
      currentIds: ['a', 'x', 'b'],
      sources: new Map([
        ['a', todo(DAY)],
        ['b', todo(DAY)],
      ]),
      targetDayIds: ['a', 'x', 'b'],
    });
    expect(actions).toEqual([transfer('a', DAY, DAY, 0), transfer('b', DAY, DAY, 1)]);
  });

  it('orders today by the Today list, transferring only cards from elsewhere', () => {
    const actions = drop({
      targetDay: TODAY,
      ids: ['a', 'b', 'c'],
      leaderId: 'b',
      orderedIds: ['x', 'b', 'a', 'y'],
      currentIds: ['x', 'a', 'y'],
      sources: new Map<string, PlannerGroupSource>([
        ['a', todo(TODAY)],
        ['b', { day: OVERDUE_LIST_ID, isScheduled: false }],
        ['c', { day: TODAY, isScheduled: true }],
      ]),
    });
    expect(actions).toEqual([
      placeInToday('a', 'x'),
      transfer('b', OVERDUE_LIST_ID, TODAY, 0),
      placeInToday('b', 'a'),
      // A timed card on today loses its time, as a single drop to the list does.
      transfer('c', TODAY, TODAY, 0),
      placeInToday('c', 'b'),
    ]);
  });

  it('moves a timed card of the target day into its list', () => {
    const actions = drop({
      orderedIds: ['a', 'x'],
      currentIds: ['x'],
      sources: new Map<string, PlannerGroupSource>([
        ['a', todo(OTHER)],
        ['b', { day: DAY, isScheduled: true }],
      ]),
      targetDayIds: ['x'],
    });
    expect(actions).toEqual([transfer('a', OTHER, DAY, 0), transfer('b', DAY, DAY, 1)]);
  });

  it('keeps the remaining subtasks of a moved parent out of the day index', () => {
    const parent = task('a', { subTaskIds: ['y'] });
    const actions = drop({
      tasks: { ...tasks, a: parent },
      orderedIds: ['x', 'a'],
      currentIds: ['x', 'y'],
      sources: new Map([
        ['a', todo(OTHER)],
        ['b', todo(OTHER)],
      ]),
      targetDayIds: ['x', 'y'],
    });
    // transferTask drops y from the day when a lands, so b goes to index 2.
    expect(actions).toEqual([
      PlannerActions.transferTask({
        task: parent,
        prevDay: OTHER,
        newDay: DAY,
        targetIndex: 1,
        today: TODAY,
      }),
      transfer('b', OTHER, DAY, 2),
    ]);
  });

  it('refuses the whole drop when a member is gone or not on screen', () => {
    const sources = new Map([['a', todo(OTHER)]]);
    expect(drop({ orderedIds: ['a'], sources })).toBeNull();
    expect(
      drop({
        orderedIds: ['a'],
        sources: new Map([...sources, ['b', todo(OTHER)]]),
        tasks: { a: tasks['a'] },
      }),
    ).toBeNull();
  });
});
