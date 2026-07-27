import { ChangeDetectorRef } from '@angular/core';
import {
  ComponentFixture,
  fakeAsync,
  flushMicrotasks,
  TestBed,
} from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';

import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';

import { Worklog } from '../worklog/worklog.model';
import { HistoryComponent } from './history.component';
import { WorklogService } from '../worklog/worklog.service';
import { WorkContextService } from '../work-context/work-context.service';
import { SimpleCounterService } from '../simple-counter/simple-counter.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { TaskService } from '../tasks/task.service';
import { Task } from '../tasks/task.model';
import { selectAllProjectColorsAndTitles } from '../project/store/project.selectors';
import { mapArchiveToWorklog } from '../worklog/util/map-archive-to-worklog';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

describe('HistoryComponent', () => {
  let fixture: ComponentFixture<HistoryComponent>;
  let matDialogSpy: jasmine.SpyObj<MatDialog>;
  let routerSpy: jasmine.SpyObj<Router>;
  let taskArchiveServiceSpy: jasmine.SpyObj<TaskArchiveService>;
  let dateServiceSpy: jasmine.SpyObj<DateService>;
  let store: Store;

  const worklogData$ = new BehaviorSubject({
    worklog: {} as Worklog,
    totalTimeSpent: 0,
  });
  const queryParams$ = new BehaviorSubject<Record<string, string>>({});

  const createTaskForDate = (
    dateStr: string,
    timeSpent = 60000,
    isDone = false,
    title = dateStr,
  ): Task =>
    ({
      attachments: [],
      created: new Date(dateStr).getTime(),
      id: title,
      isDone,
      projectId: 'project',
      subTaskIds: [],
      tagIds: [],
      timeEstimate: 0,
      timeSpent,
      timeSpentOnDay: { [dateStr]: timeSpent },
      title,
    }) as unknown as Task;

  beforeEach(async () => {
    const activatedRouteSpy: Pick<ActivatedRoute, 'queryParams' | 'snapshot'> = {
      queryParams: queryParams$.asObservable(),
      snapshot: {
        data: {},
        queryParams: {},
      } as unknown as ActivatedRoute['snapshot'],
    };
    const worklogServiceSpy = jasmine.createSpyObj<WorklogService>('WorklogService', [], {
      worklogData$,
    });
    matDialogSpy = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);
    taskArchiveServiceSpy = jasmine.createSpyObj<TaskArchiveService>(
      'TaskArchiveService',
      ['load'],
    );
    dateServiceSpy = jasmine.createSpyObj<DateService>('DateService', [
      'todayStr',
      'getStartOfNextDayDiffMs',
    ]);
    dateServiceSpy.todayStr.and.returnValue('2026-01-05');
    dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(0);
    worklogData$.next({
      worklog: {} as Worklog,
      totalTimeSpent: 0,
    });
    queryParams$.next({});

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), HistoryComponent],
      providers: [
        provideMockStore({
          selectors: [
            {
              selector: selectAllProjectColorsAndTitles,
              value: [],
            },
          ],
        }),
        provideMockActions(of()),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: activatedRouteSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: Router, useValue: routerSpy },
        { provide: TaskArchiveService, useValue: taskArchiveServiceSpy },
        { provide: TaskService, useValue: {} },
        { provide: DateService, useValue: dateServiceSpy },
        { provide: WorkContextService, useValue: {} },
        { provide: SimpleCounterService, useValue: { enabledSimpleCounters$: of([]) } },
        { provide: WorklogService, useValue: worklogServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryComponent);
    store = TestBed.inject(Store);
    spyOn(store, 'dispatch');
    fixture.detectChanges();
  });

  it('arranges month data in reverse chronological order from top to bottom', () => {
    const tasks = [
      createTaskForDate('2025-01-01'),
      createTaskForDate('2025-02-01'),
      createTaskForDate('2025-03-01'),
      createTaskForDate('2025-10-01'),
      createTaskForDate('2025-11-01'),
      createTaskForDate('2025-12-01'),
    ];

    worklogData$.next(
      mapArchiveToWorklog(
        {
          ids: tasks.map((task) => task.id),
          entities: tasks.reduce(
            (entities, task) => ({ ...entities, [task.id]: task }),
            {},
          ),
        },
        [],
        { workStart: {}, workEnd: {} },
        1,
        'en-US',
      ),
    );
    fixture.detectChanges();

    const monthTitles = fixture.debugElement
      .queryAll(By.css('.month-label'))
      .map((de) => de.nativeElement.textContent.trim());

    expect(monthTitles).toEqual([
      'December',
      'November',
      'October',
      'March',
      'February',
      'January',
    ]);
  });

  it('arranges day data in chronological order from top to bottom', () => {
    const tasks = [
      createTaskForDate('2025-01-01'),
      createTaskForDate('2025-01-02'),
      createTaskForDate('2025-01-03'),
    ];

    worklogData$.next(
      mapArchiveToWorklog(
        {
          ids: tasks.map((task) => task.id),
          entities: tasks.reduce(
            (entities, task) => ({ ...entities, [task.id]: task }),
            {},
          ),
        },
        [],
        { workStart: {}, workEnd: {} },
        1,
        'en-US',
      ),
    );
    fixture.detectChanges();

    // Expand the month (January 2025 is not the current month, so it's collapsed by default)
    fixture.componentInstance.toggleMonth('2025', '1');
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();

    const dayLabels = fixture.debugElement
      .queryAll(By.css('.week-row td:first-child'))
      .map((de) => de.nativeElement.textContent.trim());

    expect(dayLabels).toEqual(['Wed 1.', 'Thu 2.', 'Fri 3.']);
  });

  it('explicitly restores the archived hierarchy to Today once', fakeAsync(() => {
    const subTask1 = {
      ...createTaskForDate('2026-01-05', 60000, true, 'subtask1'),
      parentId: 'parent',
      dueDay: '2025-12-30',
      dueWithTime: new Date('2025-12-30T10:00:00Z').getTime(),
      remindAt: new Date('2025-12-30T09:55:00Z').getTime(),
    };
    const subTask2 = {
      ...createTaskForDate('2026-01-05', 60000, true, 'subtask2'),
      parentId: 'parent',
    };
    const parent = {
      ...createTaskForDate('2026-01-05', 60000, true, 'parent'),
      dueWithTime: new Date('2025-12-30T12:00:00Z').getTime(),
      remindAt: new Date('2025-12-30T12:00:00Z').getTime(),
      subTaskIds: [subTask1.id, subTask2.id],
    };
    matDialogSpy.open.and.returnValue({
      afterClosed: () => of(true),
    } as ReturnType<MatDialog['open']>);
    taskArchiveServiceSpy.load.and.resolveTo({
      ids: [parent.id, subTask1.id, subTask2.id],
      entities: {
        [parent.id]: parent,
        [subTask1.id]: subTask1,
        [subTask2.id]: subTask2,
      },
    });

    fixture.componentInstance.restoreTask(parent);
    flushMicrotasks();

    expect(store.dispatch).toHaveBeenCalledTimes(1);
    const action = (store.dispatch as jasmine.Spy).calls.mostRecent()
      .args[0] as ReturnType<typeof TaskSharedActions.restoreTask>;
    expect(action.task).toEqual({
      ...parent,
      dueDay: '2026-01-05',
      dueWithTime: undefined,
      remindAt: undefined,
    });
    expect(action.subTasks).toEqual([
      {
        ...subTask1,
        dueDay: undefined,
        dueWithTime: undefined,
        remindAt: undefined,
      },
      {
        ...subTask2,
        dueDay: undefined,
        dueWithTime: undefined,
        remindAt: undefined,
      },
    ]);
    expect(action.restoreToToday).toEqual({
      today: '2026-01-05',
      startOfNextDayDiffMs: 0,
    });
    expect(routerSpy.navigate).toHaveBeenCalledOnceWith(['/active/tasks']);
  }));

  it('captures the logical Today after the archive load finishes', fakeAsync(() => {
    const subTask = {
      ...createTaskForDate('2026-01-05', 60000, true, 'subtask'),
      parentId: 'parent',
    };
    const parent = {
      ...createTaskForDate('2026-01-05', 60000, true, 'parent'),
      subTaskIds: [subTask.id],
    };
    let resolveArchiveLoad!: (
      archive: Awaited<ReturnType<TaskArchiveService['load']>>,
    ) => void;
    taskArchiveServiceSpy.load.and.returnValue(
      new Promise((resolve) => {
        resolveArchiveLoad = resolve;
      }),
    );
    matDialogSpy.open.and.returnValue({
      afterClosed: () => of(true),
    } as ReturnType<MatDialog['open']>);

    fixture.componentInstance.restoreTask(parent);
    flushMicrotasks();

    dateServiceSpy.todayStr.and.returnValue('2026-01-06');
    dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(60 * 60 * 1000);
    resolveArchiveLoad({
      ids: [parent.id, subTask.id],
      entities: {
        [parent.id]: parent,
        [subTask.id]: subTask,
      },
    });
    flushMicrotasks();

    const action = (store.dispatch as jasmine.Spy).calls.mostRecent()
      .args[0] as ReturnType<typeof TaskSharedActions.restoreTask>;
    expect(action.restoreToToday).toEqual({
      today: '2026-01-06',
      startOfNextDayDiffMs: 60 * 60 * 1000,
    });
  }));
});
