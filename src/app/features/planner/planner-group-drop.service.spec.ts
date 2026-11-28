import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Store } from '@ngrx/store';
import { PlannerGroupDropService } from './planner-group-drop.service';
import { PlannerService } from './planner.service';
import { OVERDUE_LIST_ID, PlannerDay, ScheduleItemType } from './planner.model';
import { selectPlannerState } from './store/planner.selectors';
import { selectTaskEntities, selectUndoneOverdue } from '../tasks/store/task.selectors';
import { TaskMultiDragService } from '../tasks/task-multi-drag.service';
import { TaskMultiSelectService } from '../tasks/task-multi-select.service';
import { DateService } from '../../core/date/date.service';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { PlannerActions } from './store/planner.actions';

describe('PlannerGroupDropService', () => {
  const TODAY = '2026-11-09';
  const DAY = '2026-11-12';
  const task = (id: string): Task => ({ ...DEFAULT_TASK, id, title: id, projectId: 'p' });
  const tasks = { a: task('a'), b: task('b'), o: task('o'), x: task('x') };
  let service: PlannerGroupDropService;
  let dispatch: jasmine.Spy;
  let ids: ReturnType<typeof signal<readonly string[]>>;
  let isCancelled: ReturnType<typeof signal<boolean>>;
  let days$: BehaviorSubject<PlannerDay[]>;
  let suppression: boolean[];

  const day = (dayDate: string, overrides: Partial<PlannerDay> = {}): PlannerDay => ({
    dayDate,
    timeEstimate: 0,
    timeLimit: 0,
    itemsTotal: 0,
    tasks: [],
    deadlineTasks: [],
    noStartTimeRepeatProjections: [],
    allDayEvents: [],
    scheduledIItems: [],
    ...overrides,
  });

  beforeEach(() => {
    dispatch = jasmine.createSpy('dispatch');
    ids = signal<readonly string[]>(['a', 'b']);
    isCancelled = signal(false);
    suppression = [];
    days$ = new BehaviorSubject([
      day(TODAY, {
        scheduledIItems: [
          { id: 'b', type: ScheduleItemType.Task, start: 0, end: 0, task: tasks.b },
        ],
      }),
      day(DAY, { tasks: [tasks.a, tasks.x] }),
    ]);
    TestBed.configureTestingModule({
      providers: [
        PlannerGroupDropService,
        {
          provide: Store,
          useValue: {
            dispatch,
            selectSignal: (selector: unknown) =>
              selector === selectTaskEntities
                ? signal(tasks)
                : selector === selectPlannerState
                  ? signal({ days: { [DAY]: ['a', 'x'] } })
                  : selector === selectUndoneOverdue
                    ? signal([tasks.o])
                    : signal(undefined),
          },
        },
        { provide: PlannerService, useValue: { days$ } },
        { provide: TaskMultiDragService, useValue: { ids, isCancelled } },
        {
          provide: TaskMultiSelectService,
          useValue: {
            setBulkFeedbackSuppressed: (value: boolean) => suppression.push(value),
          },
        },
        { provide: DateService, useValue: { todayStr: () => TODAY } },
      ],
    });
    service = TestBed.inject(PlannerGroupDropService);
  });

  it('is a group drag only while the snapshot holds several cards', () => {
    expect(service.isGroupDrag()).toBeTrue();
    ids.set(['a']);
    expect(service.isGroupDrag()).toBeFalse();
  });

  it('moves each card from the column and list it is rendered in', () => {
    // b is timed on today; a is dropped below x on its own day.
    service.drop(DAY, 'a', ['x', 'a'], ['a', 'x']);

    expect(dispatch.calls.allArgs().map(([action]) => action)).toEqual([
      PlannerActions.transferTask({
        task: tasks.a,
        prevDay: DAY,
        newDay: DAY,
        targetIndex: 1,
        today: TODAY,
      }),
      PlannerActions.transferTask({
        task: tasks.b,
        prevDay: TODAY,
        newDay: DAY,
        targetIndex: 2,
        today: TODAY,
      }),
    ]);
    expect(suppression).toEqual([true, false]);
  });

  it('treats an overdue card as coming from the Overdue column', () => {
    ids.set(['o', 'a']);
    service.drop(DAY, 'o', ['o', 'a', 'x'], ['a', 'x']);

    expect(dispatch.calls.first().args[0]).toEqual(
      jasmine.objectContaining({ prevDay: OVERDUE_LIST_ID, targetIndex: 0 }),
    );
  });

  it('dispatches nothing after Escape or for a card the planner does not show', () => {
    isCancelled.set(true);
    service.drop(DAY, 'a', ['x', 'a'], ['a', 'x']);
    isCancelled.set(false);
    days$.next([day(DAY, { tasks: [tasks.a, tasks.x] })]);
    service.drop(DAY, 'a', ['x', 'a'], ['a', 'x']);

    expect(dispatch).not.toHaveBeenCalled();
    expect(suppression).toEqual([]);
  });
});
