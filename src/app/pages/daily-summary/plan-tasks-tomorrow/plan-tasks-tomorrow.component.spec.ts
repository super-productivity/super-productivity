import { TestBed } from '@angular/core/testing';
import { PlanTasksTomorrowComponent } from './plan-tasks-tomorrow.component';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { PlannerService } from '../../../features/planner/planner.service';
import { WorkContextService } from '../../../features/work-context/work-context.service';
import { TaskService } from '../../../features/tasks/task.service';
import { DateService } from '../../../core/date/date.service';
import { PlannerActions } from '../../../features/planner/store/planner.actions';
import { DEFAULT_TASK, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { selectUndoneTodayTaskIds } from '../../../features/work-context/store/work-context.selectors';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

describe('PlanTasksTomorrowComponent', () => {
  let store: MockStore;
  let mockPlannerService: jasmine.SpyObj<PlannerService>;
  let mockDateService: jasmine.SpyObj<DateService>;

  const mockTomorrow = { dayDate: '2026-01-07' };

  const task = (
    id: string,
    additional: Partial<TaskWithSubTasks> = {},
  ): TaskWithSubTasks =>
    ({
      ...DEFAULT_TASK,
      id,
      projectId: 'P',
      subTasks: [],
      ...additional,
    }) as TaskWithSubTasks;

  beforeEach(() => {
    mockPlannerService = jasmine.createSpyObj('PlannerService', [], {
      tomorrow$: of(mockTomorrow as any),
    });
    mockDateService = jasmine.createSpyObj('DateService', ['todayStr']);
    mockDateService.todayStr.and.returnValue('2026-01-05');

    TestBed.configureTestingModule({
      imports: [PlanTasksTomorrowComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          selectors: [{ selector: selectUndoneTodayTaskIds, value: [] }],
        }),
        { provide: PlannerService, useValue: mockPlannerService },
        { provide: DateService, useValue: mockDateService },
        { provide: WorkContextService, useValue: {} },
        { provide: TaskService, useValue: {} },
      ],
    }).overrideComponent(PlanTasksTomorrowComponent, {
      set: { template: '', imports: [] },
    });

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  it('should create the component', () => {
    const fixture = TestBed.createComponent(PlanTasksTomorrowComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should plan undone tasks for tomorrow', async () => {
    const parentTask = task('p1');
    spyOn(store, 'select').and.callFake((selector: any) => {
      if (selector === selectUndoneTodayTaskIds) {
        return of(['p1']);
      }
      return of([parentTask]);
    });

    const fixture = TestBed.createComponent(PlanTasksTomorrowComponent);
    await fixture.componentInstance.planAllTodayTomorrow();

    expect(store.dispatch).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({ day: '2026-01-07', task: parentTask }),
    );
  });

  it('should plan subtasks due today for tomorrow along with parent', async () => {
    const subTaskDueToday = task('s1', { dueDay: '2026-01-05' });
    const subTaskDueOtherDay = task('s2', { dueDay: '2026-02-01' });
    const parentTask = task('p1', {
      subTasks: [subTaskDueToday, subTaskDueOtherDay],
    });

    spyOn(store, 'select').and.callFake((selector: any) => {
      if (selector === selectUndoneTodayTaskIds) {
        return of(['p1']);
      }
      return of([parentTask]);
    });

    const fixture = TestBed.createComponent(PlanTasksTomorrowComponent);
    await fixture.componentInstance.planAllTodayTomorrow();

    expect(store.dispatch).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({ day: '2026-01-07', task: parentTask }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({ day: '2026-01-07', task: subTaskDueToday }),
    );
    expect(store.dispatch).not.toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({ day: '2026-01-07', task: subTaskDueOtherDay }),
    );
  });

  // With a start-of-next-day offset, 01:00 still belongs to yesterday;
  // the calendar day would leave subtasks due on logical today unplanned.
  it('should plan subtasks due on logical today when called past midnight', async () => {
    jasmine.clock().install();
    // calendar day 2026-01-06; the DateService mock's logical today is 2026-01-05
    jasmine.clock().mockDate(new Date(2026, 0, 6, 1));
    mockDateService.todayStr.and.returnValue('2026-01-05');

    try {
      const subTask = task('sub1', { dueDay: '2026-01-05' });
      const parentTask = task('p1', { subTasks: [subTask] });

      spyOn(store, 'select').and.callFake((selector: any) => {
        if (selector === selectUndoneTodayTaskIds) {
          return of(['p1']);
        }
        return of([parentTask]);
      });

      const fixture = TestBed.createComponent(PlanTasksTomorrowComponent);
      await fixture.componentInstance.planAllTodayTomorrow();

      expect(store.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({ day: '2026-01-07', task: parentTask }),
      );
      expect(store.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({ day: '2026-01-07', task: subTask }),
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
