import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { PlanTasksNextWeekComponent } from './plan-tasks-next-week.component';
import { selectOpenWeekTasks } from './open-week-tasks.selector';
import { DateService } from '../../../core/date/date.service';
import { PlannerService } from '../../../features/planner/planner.service';
import { PlannerActions } from '../../../features/planner/store/planner.actions';
import { DEFAULT_TASK, Task } from '../../../features/tasks/task.model';

describe('PlanTasksNextWeekComponent', () => {
  const FRIDAY = new Date(2026, 9, 30, 18);
  const task = (id: string): Task => ({ ...DEFAULT_TASK, id, projectId: 'P' });
  let store: MockStore;
  let plannerService: jasmine.SpyObj<PlannerService>;

  beforeEach(() => {
    plannerService = jasmine.createSpyObj('PlannerService', ['getDays$']);
    plannerService.getDays$.and.returnValue(of([]));
    TestBed.configureTestingModule({
      imports: [PlanTasksNextWeekComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          selectors: [{ selector: selectOpenWeekTasks, value: [task('a'), task('b')] }],
        }),
        { provide: PlannerService, useValue: plannerService },
        {
          provide: DateService,
          useValue: {
            getLogicalTodayDate: () => new Date(FRIDAY),
            todayStr: (d: Date) =>
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  it('shows next Monday to Friday', () => {
    TestBed.createComponent(PlanTasksNextWeekComponent);
    expect(plannerService.getDays$).toHaveBeenCalledWith([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
  });

  it('plans every open task on next Monday', () => {
    const fixture = TestBed.createComponent(PlanTasksNextWeekComponent);
    fixture.componentInstance.planOpenTasksOnMonday();
    expect(store.dispatch).toHaveBeenCalledTimes(2);
    expect(store.dispatch).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({ day: '2026-11-02', task: task('a') }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({ day: '2026-11-02', task: task('b') }),
    );
  });

  it('counts a subtask moving with its parent as part of it', () => {
    store.overrideSelector(selectOpenWeekTasks, [
      { ...task('sub'), parentId: 'a' },
      task('a'),
      { ...task('loneSub'), parentId: 'doneParent' },
    ]);
    const fixture = TestBed.createComponent(PlanTasksNextWeekComponent);
    expect(fixture.componentInstance.openTaskCount()).toBe(2);
  });
});
