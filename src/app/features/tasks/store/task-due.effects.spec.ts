import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Observable, BehaviorSubject, of, Subject, take } from 'rxjs';
import { Action } from '@ngrx/store';
import { getOverdueIdsInTodayOrder, TaskDueEffects } from './task-due.effects';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { SyncWrapperService } from '../../../imex/sync/sync-wrapper.service';
import { AddTasksForTomorrowService } from '../../add-tasks-for-tomorrow/add-tasks-for-tomorrow.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import {
  selectOverdueTasksOnToday,
  selectTasksDueForDay,
  selectTasksWithDueTimeForRange,
} from './task.selectors';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { DEFAULT_TASK, Task, TaskWithDueDay } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  initialTagState,
  selectTodayTagTaskIds,
  TAG_FEATURE_NAME,
} from '../../tag/store/tag.reducer';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import { initialTaskState, TASK_FEATURE_NAME } from './task.reducer';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';

describe('getOverdueIdsInTodayOrder', () => {
  it('returns overdue ids in raw Today tag order', () => {
    expect(
      getOverdueIdsInTodayOrder(
        [{ id: 'overdue-3' }, { id: 'overdue-1' }],
        ['task-0', 'overdue-1', 'task-2', 'overdue-3'],
      ),
    ).toEqual(['overdue-1', 'overdue-3']);
  });

  it('returns an empty list when overdue ids are not in the raw Today tag order', () => {
    expect(
      getOverdueIdsInTodayOrder([{ id: 'overdue-1' }], ['task-2', 'task-3']),
    ).toEqual([]);
  });
});

describe('TaskDueEffects', () => {
  let previousTimeout: number;
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
  const startOfNextDayDiffMs = 0;
  const CREATE_REPEAT_DEBOUNCE_MS = 1000;
  const REMOVE_OVERDUE_DEBOUNCE_MS = 1000;
  const ENSURE_TASKS_DUE_DEBOUNCE_MS = 2000;

  const initialState = {
    [TASK_FEATURE_NAME]: initialTaskState,
    [TAG_FEATURE_NAME]: initialTagState,
    [appStateFeatureKey]: { todayStr, startOfNextDayDiffMs },
  };

  beforeAll(() => {
    previousTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = previousTimeout;
  });

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
      'isInSyncWindow',
    ]);
    hydrationStateServiceSpy.isApplyingRemoteOps.and.returnValue(false);
    hydrationStateServiceSpy.isInSyncWindow.and.returnValue(false);
    hydrationStateServiceSpy.isInSyncWindow$ = of(false);

    TestBed.configureTestingModule({
      providers: [
        TaskDueEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState,
          selectors: [
            { selector: selectOverdueTasksOnToday, value: [] },
            { selector: selectTodayTaskIds, value: [] },
            { selector: selectTodayTagTaskIds, value: [] },
            { selector: selectTodayStr, value: todayStr },
            { selector: selectStartOfNextDayDiffMs, value: startOfNextDayDiffMs },
            { selector: selectTasksDueForDay, value: [] },
            { selector: selectTasksWithDueTimeForRange, value: [] },
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
    it('should call addAllDueToday after initial sync (async)', fakeAsync(() => {
      // Subscribe to the effect
      const subscription = effects.createRepeatableTasksAndAddDueToday$.subscribe();

      // Trigger emissions
      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(CREATE_REPEAT_DEBOUNCE_MS);

      expect(addTasksForTomorrowService.addAllDueToday).toHaveBeenCalled();
      subscription.unsubscribe();
    }));

    it('should not react to duplicate date strings (distinctUntilChanged)', fakeAsync(() => {
      const subscription = effects.createRepeatableTasksAndAddDueToday$.subscribe();

      // Wait for the initial BehaviorSubject emission to pass through the debounce,
      // then emit the same date again. The sync wrapper is also a BehaviorSubject
      // in this setup, so each inner switchMap subscription receives the current
      // "sync done" value without a manual next().
      // distinctUntilChanged should suppress the duplicate date before that point.
      tick(CREATE_REPEAT_DEBOUNCE_MS);
      const callCountAfterInitialEmission =
        addTasksForTomorrowService.addAllDueToday.calls.count();
      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      tick(CREATE_REPEAT_DEBOUNCE_MS);

      expect(addTasksForTomorrowService.addAllDueToday.calls.count()).toBe(
        callCountAfterInitialEmission,
      );
      subscription.unsubscribe();
    }));
  });

  describe('removeOverdueFormToday$', () => {
    it('should dispatch localRemoveOverdueFromToday (non-persistent) when there are overdue tasks (#6992)', fakeAsync(() => {
      const overdueTask = createTask('overdue-1', {
        dueDay: '2024-01-01', // Past date
      });

      store.overrideSelector(selectOverdueTasksOnToday, [overdueTask]);
      store.overrideSelector(selectTodayTagTaskIds, ['overdue-1', 'task-2']);
      store.refreshState();

      let emittedAction: Action | undefined;
      const subscription = effects.removeOverdueFormToday$
        .pipe(take(1))
        .subscribe((action) => {
          emittedAction = action;
        });

      // Trigger the effect
      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(REMOVE_OVERDUE_DEBOUNCE_MS);

      expect(emittedAction?.type).toBe(
        TaskSharedActions.localRemoveOverdueFromToday.type,
      );
      expect(emittedAction).toEqual(
        jasmine.objectContaining({
          taskIds: ['overdue-1'],
        }),
      );
      subscription.unsubscribe();
    }));

    it('should preserve task order from todayTagTaskIds when removing overdue', fakeAsync(() => {
      const overdueTask1 = createTask('overdue-1');
      const overdueTask2 = createTask('overdue-3');

      store.overrideSelector(selectOverdueTasksOnToday, [overdueTask1, overdueTask2]);
      // Note the specific order in raw today tag task ids
      store.overrideSelector(selectTodayTagTaskIds, [
        'task-0',
        'overdue-1',
        'task-2',
        'overdue-3',
        'task-4',
      ]);
      store.refreshState();

      let emittedAction: Action | undefined;
      const subscription = effects.removeOverdueFormToday$
        .pipe(take(1))
        .subscribe((action) => {
          emittedAction = action;
        });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(REMOVE_OVERDUE_DEBOUNCE_MS);

      expect(emittedAction).toEqual(
        jasmine.objectContaining({
          taskIds: ['overdue-1', 'overdue-3'], // Order from raw today tag task ids
        }),
      );
      subscription.unsubscribe();
    }));

    it('should not emit when no overdue tasks', fakeAsync(() => {
      store.overrideSelector(selectOverdueTasksOnToday, []);
      store.refreshState();

      let emitted = false;
      const subscription = effects.removeOverdueFormToday$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(REMOVE_OVERDUE_DEBOUNCE_MS);

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should not emit when overdue tasks exist but none are in todayTagTaskIds', fakeAsync(() => {
      // This tests the fix for the bug where removeTasksFromTodayTag was dispatched
      // with empty taskIds, causing "missing entityId/entityIds" error during sync
      const overdueTask = createTask('overdue-1', {
        dueDay: '2024-01-01', // Past date
      });

      store.overrideSelector(selectOverdueTasksOnToday, [overdueTask]);
      // raw today tag task ids do NOT contain overdue-1, so overdueIds will be empty
      store.overrideSelector(selectTodayTagTaskIds, ['task-2', 'task-3']);
      store.refreshState();

      let emitted = false;
      const subscription = effects.removeOverdueFormToday$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(REMOVE_OVERDUE_DEBOUNCE_MS);

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));
  });

  describe('ensureTasksDueTodayInTodayTag$', () => {
    it('should dispatch planTasksForToday for tasks due today not in TODAY tag', fakeAsync(() => {
      const taskDueToday = createTaskWithDueDay('due-today-1', todayStr);

      store.overrideSelector(selectTasksDueForDay, [taskDueToday]);
      store.overrideSelector(selectTodayTaskIds, ['other-task']);
      store.refreshState();

      let emittedAction: Action | undefined;
      const subscription = effects.ensureTasksDueTodayInTodayTag$
        .pipe(take(1))
        .subscribe((action) => {
          emittedAction = action;
        });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(ENSURE_TASKS_DUE_DEBOUNCE_MS);

      expect(emittedAction).toEqual(
        jasmine.objectContaining({
          taskIds: ['due-today-1'],
          today: todayStr,
          startOfNextDayDiffMs,
          isSkipRemoveReminder: true,
        }),
      );
      subscription.unsubscribe();
    }));

    it('should not emit when all tasks due today are already in TODAY tag', fakeAsync(() => {
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
      tick(ENSURE_TASKS_DUE_DEBOUNCE_MS);

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should exclude subtasks whose parent is already in TODAY', fakeAsync(() => {
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
      tick(ENSURE_TASKS_DUE_DEBOUNCE_MS);

      // Should not emit because subtask's parent is already in TODAY
      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should include subtask if parent is not in TODAY', fakeAsync(() => {
      const subtask = createTaskWithDueDay('subtask-1', todayStr, {
        parentId: 'parent-not-in-today',
      });

      store.overrideSelector(selectTasksDueForDay, [subtask]);
      store.overrideSelector(selectTodayTaskIds, ['other-task']);
      store.refreshState();

      let emittedAction: Action | undefined;
      const subscription = effects.ensureTasksDueTodayInTodayTag$
        .pipe(take(1))
        .subscribe((action) => {
          emittedAction = action;
        });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(ENSURE_TASKS_DUE_DEBOUNCE_MS);

      expect(emittedAction).toEqual(
        jasmine.objectContaining({
          taskIds: ['subtask-1'],
          today: todayStr,
          startOfNextDayDiffMs,
          isSkipRemoveReminder: true,
        }),
      );
      subscription.unsubscribe();
    }));

    it('should not emit when no tasks are due today', fakeAsync(() => {
      store.overrideSelector(selectTasksDueForDay, []);
      store.overrideSelector(selectTodayTaskIds, ['task-1']);
      store.refreshState();

      let emitted = false;
      const subscription = effects.ensureTasksDueTodayInTodayTag$.subscribe(() => {
        emitted = true;
      });

      globalTrackingIntervalService.todayDateStr$.next(todayStr);
      syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$.next(true);
      tick(ENSURE_TASKS_DUE_DEBOUNCE_MS);

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));
  });

  describe('effect initialization', () => {
    it('should wait for initial sync before processing', fakeAsync(() => {
      // Create a new sync trigger that hasn't emitted yet
      const delayedSyncTrigger$ = new Subject<boolean>();
      const emptyActions$: Observable<Action> = of();

      const hydrationStateServiceSpy2 = jasmine.createSpyObj('HydrationStateService', [
        'isApplyingRemoteOps',
        'isInSyncWindow',
      ]);
      hydrationStateServiceSpy2.isApplyingRemoteOps.and.returnValue(false);
      hydrationStateServiceSpy2.isInSyncWindow.and.returnValue(false);
      hydrationStateServiceSpy2.isInSyncWindow$ = of(false);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          TaskDueEffects,
          provideMockActions(() => emptyActions$),
          provideMockStore({
            initialState,
            selectors: [
              { selector: selectOverdueTasksOnToday, value: [] },
              { selector: selectTodayTaskIds, value: [] },
              { selector: selectTodayTagTaskIds, value: [] },
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
      tick(100);
      expect(newAddTasksService.addAllDueToday).not.toHaveBeenCalled();

      // Now trigger sync completion
      delayedSyncTrigger$.next(true);
      delayedSyncTrigger$.complete();
      tick(CREATE_REPEAT_DEBOUNCE_MS);

      expect(newAddTasksService.addAllDueToday).toHaveBeenCalled();
      subscription.unsubscribe();
    }));
  });
});
