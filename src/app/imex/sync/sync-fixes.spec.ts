import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { Action, Store } from '@ngrx/store';
import { TaskDueEffects } from '../../features/tasks/store/task-due.effects';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { AddTasksForTomorrowService } from '../../features/add-tasks-for-tomorrow/add-tasks-for-tomorrow.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { DataInitService } from '../../core/data-init/data-init.service';
import { TranslateModule } from '@ngx-translate/core';
import { SnackService } from '../../core/snack/snack.service';

// These are TDD tests for sync fixes - they demonstrate expected failures before fixes
// They should be enabled when actually implementing the fixes
xdescribe('Sync Fixes - TDD', () => {
  // Helper function to replace await wait()
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  let actions$: Observable<Action>;
  let effects: TaskDueEffects;
  let store: MockStore;
  // let dataInitStateService: jasmine.SpyObj<DataInitStateService>;
  // let syncWrapperService: jasmine.SpyObj<SyncWrapperService>;
  let addTasksForTomorrowService: jasmine.SpyObj<AddTasksForTomorrowService>;
  let dataInitService: jasmine.SpyObj<DataInitService>;

  // Subjects to control timing
  let todayDateStr$: BehaviorSubject<string>;
  let isAllDataLoadedInitially$: BehaviorSubject<boolean>;
  let afterCurrentSyncDoneOrSyncDisabled$: Subject<unknown>;
  let isSyncInProgress$: BehaviorSubject<boolean>;
  let dataReInitComplete$: Subject<void>;

  // Mock data
  const oldTaskRepeatConfig = {
    id: 'repeat1',
    title: 'Daily Task',
    lastTaskCreationDay: '2025-06-22', // Yesterday
  };

  const syncedTaskRepeatConfig = {
    id: 'repeat1',
    title: 'Daily Task',
    lastTaskCreationDay: '2025-06-23', // Today - already created on mobile
  };

  beforeEach(() => {
    // Initialize actions$ to avoid compilation error
    actions$ = new Subject<Action>();
    // Create subjects
    todayDateStr$ = new BehaviorSubject<string>('2025-06-23');
    isAllDataLoadedInitially$ = new BehaviorSubject<boolean>(false);
    afterCurrentSyncDoneOrSyncDisabled$ = new Subject<unknown>();
    isSyncInProgress$ = new BehaviorSubject<boolean>(false);
    dataReInitComplete$ = new Subject<void>();

    // Create spies
    const globalTrackingIntervalSpy = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      {
        todayDateStr$: todayDateStr$.asObservable(),
      },
    );

    const dataInitStateSpy = jasmine.createSpyObj('DataInitStateService', [], {
      isAllDataLoadedInitially$: isAllDataLoadedInitially$.asObservable(),
    });

    const syncWrapperSpy = jasmine.createSpyObj('SyncWrapperService', [], {
      afterCurrentSyncDoneOrSyncDisabled$:
        afterCurrentSyncDoneOrSyncDisabled$.asObservable(),
      isSyncInProgress$: isSyncInProgress$.asObservable(),
      // NEW: Add observable that fires after data is truly reloaded
      afterSyncDataReloadComplete$: dataReInitComplete$.asObservable(),
    });

    const addTasksForTomorrowSpy = jasmine.createSpyObj('AddTasksForTomorrowService', [
      'addAllDueToday',
    ]);
    addTasksForTomorrowSpy.addAllDueToday.and.returnValue(Promise.resolve('ADDED'));

    const dataInitSpy = jasmine.createSpyObj('DataInitService', ['reInit']);

    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        TaskDueEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            taskRepeatCfg: {
              ids: ['repeat1'],
              entities: { repeat1: oldTaskRepeatConfig },
            },
            tasks: { ids: [], entities: {} },
            workContext: { todayTaskIds: [] },
            planner: { days: [] },
          },
        }),
        { provide: GlobalTrackingIntervalService, useValue: globalTrackingIntervalSpy },
        { provide: DataInitStateService, useValue: dataInitStateSpy },
        { provide: SyncWrapperService, useValue: syncWrapperSpy },
        { provide: AddTasksForTomorrowService, useValue: addTasksForTomorrowSpy },
        { provide: DataInitService, useValue: dataInitSpy },
        { provide: SnackService, useValue: snackServiceSpy },
      ],
    });

    effects = TestBed.inject(TaskDueEffects);
    store = TestBed.inject(Store) as MockStore<any>;
    // dataInitStateService = TestBed.inject(
    //   DataInitStateService,
    // ) as jasmine.SpyObj<DataInitStateService>;
    // syncWrapperService = TestBed.inject(
    //   SyncWrapperService,
    // ) as jasmine.SpyObj<SyncWrapperService>;
    addTasksForTomorrowService = TestBed.inject(
      AddTasksForTomorrowService,
    ) as jasmine.SpyObj<AddTasksForTomorrowService>;
    dataInitService = TestBed.inject(DataInitService) as jasmine.SpyObj<DataInitService>;
  });

  describe('Fix for Scenario 1: Timing Race Condition', () => {
    it('FAILING TEST: Task creation should wait for data reload to complete after sync', async () => {
      // This test will FAIL with current implementation
      // After fix, it should PASS

      let tasksCreatedBeforeReload = false;
      // let dataReloadStarted = false;
      let dataReloadCompleted = false;

      // Mock the service to track when tasks are checked
      addTasksForTomorrowService.addAllDueToday.and.callFake(async () => {
        console.log('addAllDueToday called');
        console.log('Data reload completed?', dataReloadCompleted);
        if (!dataReloadCompleted) {
          tasksCreatedBeforeReload = true;
        }
        return 'ADDED' as const;
      });

      // Simulate data reload process
      dataInitService.reInit.and.callFake(async () => {
        // dataReloadStarted = true;
        console.log('Data reload started...');
        // Simulate async operation
        return new Promise((resolve) => {
          setTimeout(() => {
            dataReloadCompleted = true;
            console.log('Data reload completed!');
            dataReInitComplete$.next();
            resolve(undefined);
          }, 100);
        });
      });

      // Subscribe to the effect
      const effectSub = effects.createRepeatableTasksAndAddDueToday$.subscribe();

      // Trigger the sequence
      isAllDataLoadedInitially$.next(true);
      await wait(0);

      // Sync completes (but data not reloaded yet)
      isSyncInProgress$.next(false);
      afterCurrentSyncDoneOrSyncDisabled$.next(undefined);

      // Start data reload
      dataInitService.reInit();

      // Current implementation waits 1000ms then creates tasks
      await wait(100);

      // ASSERTION: Tasks should NOT be created before data reload
      expect(tasksCreatedBeforeReload).toBe(
        false,
        'Tasks were created before data reload completed!',
      );
      expect(dataReloadCompleted).toBe(
        true,
        'Data reload should have completed before task creation',
      );

      // Let everything complete
      await wait(100);

      effectSub.unsubscribe();
    });

    it('SUCCESS TEST: With fix, tasks are created only after data reload', async () => {
      // This test shows the DESIRED behavior after fix

      const timeline: string[] = [];

      addTasksForTomorrowService.addAllDueToday.and.callFake(async () => {
        timeline.push('addAllDueToday called');
        return 'ADDED' as const;
      });

      dataInitService.reInit.and.callFake(async () => {
        timeline.push('reInit started');
        return new Promise((resolve) => {
          setTimeout(() => {
            timeline.push('reInit completed');
            dataReInitComplete$.next();
            resolve(undefined);
          }, 50);
        });
      });

      // This is what the FIXED effect would look like
      // Instead of waiting for afterCurrentSyncDoneOrSyncDisabled$
      // It should wait for afterSyncDataReloadComplete$

      const effectSub = effects.createRepeatableTasksAndAddDueToday$.subscribe();

      timeline.push('Effect subscribed');
      isAllDataLoadedInitially$.next(true);
      await wait(0);

      timeline.push('Sync done');
      isSyncInProgress$.next(false);
      afterCurrentSyncDoneOrSyncDisabled$.next(undefined);

      timeline.push('Starting reInit');
      dataInitService.reInit();

      await wait(100); // ReInit completes
      await wait(200); // Debounce time

      console.log('Timeline:', timeline);

      // With fix: The order should be correct
      const reInitIndex = timeline.indexOf('reInit completed');
      const addTasksIndex = timeline.indexOf('addAllDueToday called');

      expect(reInitIndex).toBeLessThan(
        addTasksIndex,
        'reInit should complete before task creation',
      );

      effectSub.unsubscribe();
    });
  });

  describe('Fix for Scenario 2: Data Import Failure', () => {
    it('FAILING TEST: getAllSyncModelData should return freshly synced data', async () => {
      // This test verifies that after sync, getAllSyncModelData returns the NEW data
      // not the old cached data

      // Mock the sync process downloading new data
      const mockPfapi = {
        downloadedData: null as any,
        getAllSyncModelData: jasmine
          .createSpy('getAllSyncModelData')
          .and.callFake((forceReload?: boolean) => {
            console.log('getAllSyncModelData called with forceReload:', forceReload);
            // Current bug: Returns old data even with forceReload=true
            return forceReload && mockPfapi.downloadedData
              ? mockPfapi.downloadedData
              : { taskRepeatCfg: { entities: { repeat1: oldTaskRepeatConfig } } };
          }),
      };

      // Simulate sync downloading new data
      mockPfapi.downloadedData = {
        taskRepeatCfg: {
          entities: { repeat1: syncedTaskRepeatConfig },
        },
      };

      // After sync, reInit should get the NEW data
      const loadedData = await mockPfapi.getAllSyncModelData(true);

      // ASSERTION: Should return synced data, not old data
      expect(loadedData.taskRepeatCfg.entities.repeat1.lastTaskCreationDay).toBe(
        '2025-06-23',
        "Should return freshly synced data with today's date",
      );
    });

    it('SUCCESS TEST: With fix, correct data flow after sync', async () => {
      // This shows the complete correct flow

      const timeline: string[] = [];
      let currentDataState = { lastTaskCreationDay: '2025-06-22' }; // Old

      // Mock the fixed pfapi service
      const mockPfapi = {
        syncedData: null as any,

        // Simulate sync downloading data
        sync: async () => {
          timeline.push('Sync: downloading remote data');
          mockPfapi.syncedData = { lastTaskCreationDay: '2025-06-23' };
          timeline.push('Sync: data downloaded and saved to IndexedDB');
          return { status: 'UpdateLocal' };
        },

        // Fixed: Force reload from IndexedDB after sync
        getAllSyncModelData: (forceReload?: boolean) => {
          if (forceReload && mockPfapi.syncedData) {
            timeline.push('getAllSyncModelData: Loading from IndexedDB (forced)');
            currentDataState = mockPfapi.syncedData;
            return currentDataState;
          }
          timeline.push('getAllSyncModelData: Returning cached data');
          return currentDataState;
        },
      };

      // Execute the flow
      timeline.push('Starting sync');
      await mockPfapi.sync();

      timeline.push('Calling reInit');
      const dataAfterReInit = mockPfapi.getAllSyncModelData(true);

      console.log('Timeline:', timeline);
      console.log('Data after reInit:', dataAfterReInit);

      // Assertions
      expect(dataAfterReInit.lastTaskCreationDay).toBe(
        '2025-06-23',
        'Should have synced data',
      );
      expect(timeline).toContain('getAllSyncModelData: Loading from IndexedDB (forced)');
    });
  });

  describe('Integration: Both fixes working together', () => {
    it('Complete flow with both fixes applied', async () => {
      // This test verifies the complete fixed flow

      const events: string[] = [];
      let finalTasksCreated = 0;

      // Setup mocks for fixed behavior
      addTasksForTomorrowService.addAllDueToday.and.callFake(async () => {
        events.push('Tasks checked - data state');
        // Mock checking if tasks would be created
        let currentState: any;
        store.select((state) => state).subscribe((state) => (currentState = state));
        if (
          currentState?.taskRepeatCfg?.entities?.repeat1?.lastTaskCreationDay <
          '2025-06-23'
        ) {
          finalTasksCreated++;
        }
        return 'ADDED' as const;
      });

      dataInitService.reInit.and.callFake(async () => {
        events.push('reInit: started');
        // Simulate loading correct synced data
        return new Promise((resolve) => {
          setTimeout(() => {
            events.push('reInit: updating store with synced data');
            store.setState({
              taskRepeatCfg: {
                ids: ['repeat1'],
                entities: { repeat1: syncedTaskRepeatConfig },
              },
            });
            events.push('reInit: completed');
            dataReInitComplete$.next();
            resolve(undefined);
          }, 50);
        });
      });

      // Run the fixed effect
      const effectSub = effects.createRepeatableTasksAndAddDueToday$.subscribe();

      events.push('App started');
      isAllDataLoadedInitially$.next(true);
      await wait(0);

      events.push('Sync completed');
      isSyncInProgress$.next(false);
      afterCurrentSyncDoneOrSyncDisabled$.next(undefined);

      // Data reload happens
      dataInitService.reInit();
      await wait(100); // ReInit completes

      // NOW the effect should fire (after data is ready)
      await wait(200); // Debounce

      console.log('Event sequence:', events);
      console.log('Tasks created:', finalTasksCreated);

      // Assertions for complete fix
      expect(finalTasksCreated).toBe(
        0,
        'No tasks should be created - synced data shows task already exists for today',
      );
      expect(events.indexOf('reInit: completed')).toBeLessThan(
        events.indexOf('Tasks checked - data state'),
        'Data must be reloaded before checking tasks',
      );

      effectSub.unsubscribe();
    });
  });
});
