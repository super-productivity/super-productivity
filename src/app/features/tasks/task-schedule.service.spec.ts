import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TaskScheduleService } from './task-schedule.service';
import { TaskService } from './task.service';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { DEFAULT_TASK, Task } from './task.model';
import { getDbDateStr } from '../../util/get-db-date-str';

describe('TaskScheduleService', () => {
  let service: TaskScheduleService;
  let dispatch: jasmine.Spy;
  let taskService: jasmine.SpyObj<TaskService>;

  const today = getDbDateStr();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getDbDateStr(tomorrowDate);
  const task = (overrides: Partial<Task> = {}): Task =>
    ({ ...DEFAULT_TASK, id: 't1', projectId: 'p1', ...overrides }) as Task;

  beforeEach(() => {
    dispatch = jasmine.createSpy('dispatch');
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['scheduleTask']);
    TestBed.configureTestingModule({
      providers: [
        TaskScheduleService,
        { provide: Store, useValue: { dispatch } },
        { provide: TaskService, useValue: taskService },
        { provide: GlobalConfigService, useValue: { cfg: () => DEFAULT_GLOBAL_CONFIG } },
        {
          provide: DateService,
          useValue: {
            todayStr: () => today,
            isToday: (ts: number) => getDbDateStr(ts) === today,
            getStartOfNextDayDiffMs: () => 0,
          },
        },
      ],
    });
    service = TestBed.inject(TaskScheduleService);
  });

  it('plans an untimed task for another day', () => {
    const t = task();
    expect(service.planForDay(t, tomorrow, false)).toBeTrue();
    expect(dispatch).toHaveBeenCalledOnceWith(
      PlannerActions.planTaskForDay({ task: t, day: tomorrow, isShowSnack: false }),
    );
  });

  it('adds a task to Today when planned for today', () => {
    const t = task({ parentId: 'parent' });
    expect(service.planForDay(t, today)).toBeTrue();
    expect(dispatch).toHaveBeenCalledOnceWith(
      TaskSharedActions.planTasksForToday({
        taskIds: ['t1'],
        today,
        startOfNextDayDiffMs: 0,
        parentTaskMap: { t1: 'parent' },
        isShowSnack: true,
      }),
    );
  });

  it('keeps the start time when a timed task moves to another day', () => {
    const due = new Date();
    due.setHours(15, 30, 0, 0);
    const t = task({ dueWithTime: due.getTime() });
    service.planForDay(t, tomorrow);
    const expected = new Date(tomorrowDate);
    expected.setHours(15, 30, 0, 0);
    expect(taskService.scheduleTask).toHaveBeenCalledOnceWith(
      t,
      expected.getTime(),
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
      false,
    );
  });

  it('only adds a task timed today to Today when planned for today', () => {
    const t = task({ dueWithTime: Date.now() });
    service.planForDay(t, today);
    expect(taskService.scheduleTask).not.toHaveBeenCalled();
    expect(dispatch.calls.mostRecent().args[0].type).toBe(
      TaskSharedActions.planTasksForToday.type,
    );
  });

  it('dispatches nothing for a task already planned for that day', () => {
    expect(service.planForDay(task({ dueDay: tomorrow }), tomorrow)).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
    expect(taskService.scheduleTask).not.toHaveBeenCalled();
  });
});
