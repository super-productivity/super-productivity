import { TaskService } from './task.service';
import { TestBed } from '@angular/core/testing';
import { StoreModule, Store } from '@ngrx/store';
import { taskReducer, TASK_FEATURE_NAME } from './store/task.reducer';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { of, Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { RouterTestingModule } from '@angular/router/testing';
import { taskAdapter } from './store/task.reducer';
import { WorkContextService } from '../work-context/work-context.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { GlobalConfigService } from '../config/global-config.service';

describe('Multi-Timer Support', () => {
  let taskService: TaskService;
  let store: Store;
  let tickSubject: Subject<any>;

  const t1 = {
    id: 't1',
    title: 'Task 1',
    subTaskIds: [],
    tagIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    isCurrent: false,
  } as any;
  const t2 = {
    id: 't2',
    title: 'Task 2',
    subTaskIds: [],
    tagIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    isCurrent: false,
  } as any;

  beforeEach(() => {
    tickSubject = new Subject();

    TestBed.configureTestingModule({
      imports: [
        HttpClientModule,
        TranslateModule.forRoot(),
        RouterTestingModule,
        StoreModule.forRoot({
          [TASK_FEATURE_NAME]: (state: any, action: any) => {
            const s = taskReducer(state, action);
            if (action.type === 'INIT_TASKS') {
              return taskAdapter.addMany([t1, t2], s);
            }
            return s;
          },
        }),
      ],
      providers: [
        TaskService,
        {
          provide: GlobalTrackingIntervalService,
          useValue: {
            tick$: tickSubject.asObservable(),
            tick: () => ({ duration: 0, date: '2026-02-15' }),
            todayDateStr: () => '2026-02-15',
            todayDateStr$: of('2026-02-15'),
          },
        },
        {
          provide: WorkContextService,
          useValue: {
            mainListTaskIds$: of(['t1', 't2']),
            startableTasksForActiveContext: () => [],
            activeWorkContextId: 'test-project',
          },
        },
        {
          provide: ImexViewService,
          useValue: {
            isDataImportInProgress$: of(false),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: () => ({
              timeTracking: {
                isMultiTaskTrackingEnabled: true,
              },
            }),
            cfg$: of({
              timeTracking: {
                isMultiTaskTrackingEnabled: true,
              },
            }),
            appFeatures: () => ({
              isTimeTrackingEnabled: true,
            }),
          },
        },
      ],
    });

    taskService = TestBed.inject(TaskService);
    store = TestBed.inject(Store);
    store.dispatch({ type: 'INIT_TASKS' });
  });

  it('should allow multiple tasks to be active at the same time', (done) => {
    // Start T1
    taskService.startTask('t1');
    // Start T2
    taskService.startTask('t2');

    taskService.allTasks$.pipe(take(1)).subscribe((tasks) => {
      const task1 = tasks.find((t) => t.id === 't1');
      const task2 = tasks.find((t) => t.id === 't2');

      expect(task1?.isCurrent).toBe(true);
      expect(task2?.isCurrent).toBe(true);
      done();
    });
  });

  it('should track time for all active tasks', (done) => {
    taskService.startTask('t1');
    taskService.startTask('t2');

    tickSubject.next({
      duration: 1000,
      date: '2026-02-15',
      timestamp: Date.now(),
    });

    taskService.allTasks$.pipe(take(1)).subscribe((tasks) => {
      const task1 = tasks.find((t) => t.id === 't1');
      const task2 = tasks.find((t) => t.id === 't2');

      expect(task1?.timeSpent).toBe(1000);
      expect(task2?.timeSpent).toBe(1000);
      done();
    });
  });

  it('should stop a task independently', (done) => {
    taskService.startTask('t1');
    taskService.startTask('t2');

    taskService.stopTask('t1');

    taskService.allTasks$.pipe(take(1)).subscribe((tasks) => {
      const task1 = tasks.find((t) => t.id === 't1');
      const task2 = tasks.find((t) => t.id === 't2');

      expect(task1?.isCurrent).toBe(false);
      expect(task2?.isCurrent).toBe(true);
      done();
    });
  });
});
