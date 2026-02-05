import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Observable, BehaviorSubject, of, Subject, take } from 'rxjs';
import { Action } from '@ngrx/store';
import { TaskDueEffects } from './task-due.effects';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { SyncWrapperService } from '../../../imex/sync/sync-wrapper.service';
import { AddTasksForTomorrowService } from '../../add-tasks-for-tomorrow/add-tasks-for-tomorrow.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { selectOverdueTasksOnToday, selectTasksDueForDay } from './task.selectors';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { DEFAULT_TASK, Task, TaskWithDueDay } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';

// These tests are skipped because TaskDueEffects imports SyncTriggerService which
// imports PfapiService which imports pfapi-config.ts. That file eagerly instantiates
// PFAPI_SYNC_PROVIDERS (including Dropbox) at module load time, which fails in the
// test environment. This requires architectural changes to lazy-load sync providers.
// See also: src/app/imex/sync/sync.effects.spec.ts for similar pattern.
// TODO: Refactor pfapi-config.ts to lazy-load sync providers to enable these tests.
xdescribe('TaskDueEffects', () => {
  const actions$: Observable<Action> = of();
  let effects: TaskDueEffects;
  let store: MockStore;
  let globalTrackingIntervalService: {
    todayDateStr$: BehaviorSubject<string>;
  };
  let syncWrapperService: {
    afterCurrentSyncDoneOrSyncDisabled$: BehaviorSubject<boolean>;
  };
  let addTasksForTomorrowService: jasmine.SpyObj<AddTasksForTomorrowService>;

  const todayStr = getDbDateStr();

  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    created: Date.now(),
    ...partial,
  });

  const createTaskWithDueDay = (
    id: string,
    dueDay: string,
    partial: Partial<Task> = {},
  ): TaskWithDueDay => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    created: Date.now(),
    ...partial,
    dueDay, // Must come after partial to ensure dueDay is always set
  });

  beforeEach(() => {
    // Create behavior subjects to control the stream emissions
    const todayDateStr$ = new BehaviorSubject<string>(todayStr);
    const afterCurrentSyncDoneOrSyncDisabled$ = new BehaviorSubject<boolean>(true);
    const afterInitialSyncDoneAndDataLoadedInitially$ = new BehaviorSubject<boolean>(
      true,
    );

    const addTasksForTomorrowServiceSpy = jasmine.createSpyObj(
      'AddTasksForTomorrowService',
      ['addAllDueToday'],
    );
    addTasksForTomorrowServiceSpy.addAllDueToday.and.returnValue(of(undefined));

    const hydrationStateServiceSpy = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
    ]);
    hydrationStateServiceSpy.isApplyingRemoteOps.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        TaskDueEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            { selector: selectOverdueTasksOnToday, value: [] },
            { selector: selectTodayTaskIds, value: [] },
          ],
        }),
        {
          provide: GlobalTrackingIntervalService,
          useValue: { todayDateStr$ },
        },
        {
          provide: SyncWrapperService,
          useValue: { afterCurrentSyncDoneOrSyncDisabled$ },
        },
        {
          provide: AddTasksForTomorrowService,
          useValue: addTasksForTomorrowServiceSpy,
        },
        {
          provide: SyncTriggerService,
          useValue: {
            afterInitialSyncDoneAndDataLoadedInitially$,
            afterInitialSyncDoneStrict$: afterInitialSyncDoneAndDataLoadedInitially$,
          },
        },
        {
          provide: HydrationStateService,
          useValue: hydrationStateServiceSpy,
        },
      ],
    });

    effects = TestBed.inject(TaskDueEffects);
    store = TestBed.inject(MockStore);
    globalTrackingIntervalService = TestBed.inject(
      GlobalTrackingIntervalService,
    ) as unknown as {
      todayDateStr$: BehaviorSubject<string>;
    };
    syncWrapperService = TestBed.inject(SyncWrapperService) as unknown as {
      afterCurrentSyncDoneOrSyncDisabled$: BehaviorSubject<boolean>;
    };
    addTasksForTomorrowService = TestBed.inject(
      AddTasksForTomorrowService,
    ) as jasmine.SpyObj<AddTasksForTomorrowService>;
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('createRepeatableTasksAndAddDueToday$', () => {
    it('should call addAllDueToday after initial sync (async)', (done) => {
      // Subscribe to the effect
      const subscription = effects.createRepeatableTasksAndAddDueToday$.subscribe(() => {
        // The effect should have called addAllDueToday
        expect(addTasksForTomorrowService.addAllDueToday).toHaveBeenCalled();
        subscription.unsubscribe();
        done();
      });

      // Trigger emissions
      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

      // If effect doesn't emit within timeout, test will fail
      setTimeout(() => {
        if (!addTasksForTomorrowService.addAllDueToday.calls.count()) {
          // Effect has debounceTime, so we might need to wait longer
          // This is expected since effect has 1000ms debounceTime
        }
      }, 100);
    });

    it('should not react to duplicate date strings (distinctUntilChanged)', (done) => {
      let emitCount = 0;

      const subscription = effects.createRepeatableTasksAndAddDueToday$.subscribe(() => {
        emitCount++;
      });

      // Emit initial date
      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

      // Wait for debounce to pass, then check only one emission for same date
      setTimeout(() => {
        // Emit same date again - should be ignored
        globalTrackingIntervalService.todayDateStr$.next(todayStr);
        syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

        setTimeout(() => {
          // Only first emission should have triggered
          expect(emitCount).toBeLessThanOrEqual(1);
          subscription.unsubscribe();
          done();
        }, 1500);
      }, 1500);
    });
  });

  describe('removeOverdueFormToday$', () => {
    it('should dispatch removeTasksFromTodayTag when there are overdue tasks', (done) => {
      const overdueTask = createTask('overdue-1', {
        dueDay: '2024-01-01', // Past date
      });

      store.overrideSelector(selectOverdueTasksOnToday, [overdueTask]);
      store.overrideSelector(selectTodayTaskIds, ['overdue-1', 'task-2']);
      store.refreshState();

      const subscription = effects.removeOverdueFormToday$.pipe(take(1)).subscribe({
        next: (action) => {
          expect(action).toEqual(
            jasmine.objectContaining({
              taskIds: ['overdue-1'],
            }),
          );
          subscription.unsubscribe();
          done();
        },
        error: done.fail,
      });

      // Trigger the effect
      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
    });

    it('should preserve task order from todayTaskIds when removing overdue', (done) => {
      const overdueTask1 = createTask('overdue-1');
      const overdueTask2 = createTask('overdue-3');

      store.overrideSelector(selectOverdueTasksOnToday, [overdueTask1, overdueTask2]);
      // Note the specific order in todayTaskIds
      store.overrideSelector(selectTodayTaskIds, [
        'task-0',
        'overdue-1',
        'task-2',
        'overdue-3',
        'task-4',
      ]);
      store.refreshState();

      const subscription = effects.removeOverdueFormToday$.pipe(take(1)).subscribe({
        next: (action) => {
          expect(action).toEqual(
            jasmine.objectContaining({
              taskIds: ['overdue-1', 'overdue-3'], // Order from todayTaskIds
            }),
          );
          subscription.unsubscribe();
          done();
        },
        error: done.fail,
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
    });

    it('should not emit when no overdue tasks', (done) => {
      store.overrideSelector(selectOverdueTasksOnToday, []);
      store.refreshState();

      let emitted = false;
      const subscription = effects.removeOverdueFormToday$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

      // Wait for potential emission
      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 1500);
    });

    it('should not emit when overdue tasks exist but none are in todayTaskIds', (done) => {
      // This tests the fix for the bug where removeTasksFromTodayTag was dispatched
      // with empty taskIds, causing "missing entityId/entityIds" error during sync
      const overdueTask = createTask('overdue-1', {
        dueDay: '2024-01-01', // Past date
      });

      store.overrideSelector(selectOverdueTasksOnToday, [overdueTask]);
      // todayTaskIds does NOT contain overdue-1, so overdueIds will be empty
      store.overrideSelector(selectTodayTaskIds, ['task-2', 'task-3']);
      store.refreshState();

      let emitted = false;
      const subscription = effects.removeOverdueFormToday$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

      // Wait for potential emission - should not emit because no matching tasks
      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 1500);
    });
  });

  describe('ensureTasksDueTodayInTodayTag$', () => {
    it('should dispatch planTasksForToday for tasks due today not in TODAY tag', (done) => {
      const taskDueToday = createTaskWithDueDay('due-today-1', todayStr);

      store.overrideSelector(selectTasksDueForDay, [taskDueToday]);
      store.overrideSelector(selectTodayTaskIds, ['other-task']);
      store.refreshState();

      const subscription = effects.ensureTasksDueTodayInTodayTag$
        .pipe(take(1))
        .subscribe({
          next: (action) => {
            expect(action).toEqual(
              jasmine.objectContaining({
                taskIds: ['due-today-1'],
                isSkipRemoveReminder: true,
              }),
            );
            subscription.unsubscribe();
            done();
          },
          error: done.fail,
        });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
    });

    it('should not emit when all tasks due today are already in TODAY tag', (done) => {
      const taskDueToday = createTaskWithDueDay('due-today-1', todayStr);

      store.overrideSelector(selectTasksDueForDay, [taskDueToday]);
      store.overrideSelector(selectTodayTaskIds, ['due-today-1']);
      store.refreshState();

      let emitted = false;
      const subscription = effects.ensureTasksDueTodayInTodayTag$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 2500);
    });

    it('should exclude subtasks whose parent is already in TODAY', (done) => {
      const parentTask = createTaskWithDueDay('parent-1', todayStr);
      const subtask = createTaskWithDueDay('subtask-1', todayStr, {
        parentId: 'parent-1',
      });

      store.overrideSelector(selectTasksDueForDay, [parentTask, subtask]);
      // Parent is in TODAY, subtask is not
      store.overrideSelector(selectTodayTaskIds, ['parent-1']);
      store.refreshState();

      let emitted = false;
      const subscription = effects.ensureTasksDueTodayInTodayTag$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

      setTimeout(() => {
        // Should not emit because subtask's parent is already in TODAY
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 2500);
    });

    it('should include subtask if parent is not in TODAY', (done) => {
      const subtask = createTaskWithDueDay('subtask-1', todayStr, {
        parentId: 'parent-not-in-today',
      });

      store.overrideSelector(selectTasksDueForDay, [subtask]);
      store.overrideSelector(selectTodayTaskIds, ['other-task']);
      store.refreshState();

      const subscription = effects.ensureTasksDueTodayInTodayTag$
        .pipe(take(1))
        .subscribe({
          next: (action) => {
            expect(action).toEqual(
              jasmine.objectContaining({
                taskIds: ['subtask-1'],
                isSkipRemoveReminder: true,
              }),
            );
            subscription.unsubscribe();
            done();
          },
          error: done.fail,
        });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
    });

    it('should not emit when no tasks are due today', (done) => {
      store.overrideSelector(selectTasksDueForDay, []);
      store.overrideSelector(selectTodayTaskIds, ['task-1']);
      store.refreshState();

      let emitted = false;
      const subscription = effects.ensureTasksDueTodayInTodayTag$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);

      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 2500);
    });
  });

  describe('effect initialization', () => {
    it('should wait for initial sync before processing', (done) => {
      // Create a new sync trigger that hasn't emitted yet
      const delayedSyncTrigger$ = new Subject<boolean>();
      const emptyActions$: Observable<Action> = of();

      const hydrationStateServiceSpy2 = jasmine.createSpyObj('HydrationStateService', [
        'isApplyingRemoteOps',
      ]);
      hydrationStateServiceSpy2.isApplyingRemoteOps.and.returnValue(false);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          TaskDueEffects,
          provideMockActions(() => emptyActions$),
          provideMockStore({
            selectors: [
              { selector: selectOverdueTasksOnToday, value: [] },
              { selector: selectTodayTaskIds, value: [] },
            ],
          }),
          {
            provide: GlobalTrackingIntervalService,
            useValue: { todayDateStr$: new BehaviorSubject<string>(todayStr) },
          },
          {
            provide: SyncWrapperService,
            useValue: {
              afterCurrentSyncDoneOrSyncDisabled$: new BehaviorSubject<boolean>(true),
            },
          },
          {
            provide: AddTasksForTomorrowService,
            useValue: { addAllDueToday: jasmine.createSpy().and.returnValue(of(void 0)) },
          },
          {
            provide: SyncTriggerService,
            useValue: {
              afterInitialSyncDoneAndDataLoadedInitially$: delayedSyncTrigger$,
              afterInitialSyncDoneStrict$: delayedSyncTrigger$,
            },
          },
          {
            provide: HydrationStateService,
            useValue: hydrationStateServiceSpy2,
          },
        ],
      });

      const newEffects = TestBed.inject(TaskDueEffects);
      const newAddTasksService = TestBed.inject(
        AddTasksForTomorrowService,
      ) as jasmine.SpyObj<AddTasksForTomorrowService>;

      const subscription = newEffects.createRepeatableTasksAndAddDueToday$.subscribe();

      // Should not have been called yet because sync hasn't completed
      setTimeout(() => {
        expect(newAddTasksService.addAllDueToday).not.toHaveBeenCalled();

        // Now trigger sync completion
        delayedSyncTrigger$.next(true);
        delayedSyncTrigger$.complete();

        // Wait for effect to process
        setTimeout(() => {
          expect(newAddTasksService.addAllDueToday).toHaveBeenCalled();
          subscription.unsubscribe();
          done();
        }, 1500);
      }, 100);
    });
  });
});
