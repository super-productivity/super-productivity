import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';
import { TaskRepeatCleanupEffects } from './task-repeat-cleanup.effects';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { SyncWrapperService } from '../../../imex/sync/sync-wrapper.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { DeletedTaskIssueSidecarService } from '../../issue/two-way-sync/deleted-task-issue-sidecar.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('TaskRepeatCleanupEffects', () => {
  let effects: TaskRepeatCleanupEffects;
  let store: jasmine.SpyObj<Store>;
  let repeatableTasks$: BehaviorSubject<TaskWithSubTasks[]>;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayMs = new Date().setHours(12, 0, 0, 0);
  const yesterdayMs = todayMs - DAY_MS;

  const wrapWithSubTasks = (task: Task): TaskWithSubTasks => ({
    ...task,
    subTasks: [],
  });

  const getDispatchedDeleteIds = (): string[] => {
    const deleteCalls = store.dispatch.calls.allArgs().filter(([action]) => {
      const a = action as unknown as { type: string };
      return a.type === TaskSharedActions.deleteTasks.type;
    });
    return deleteCalls.flatMap(
      ([action]) =>
        (action as unknown as ReturnType<typeof TaskSharedActions.deleteTasks>).taskIds,
    );
  };

  beforeEach(() => {
    repeatableTasks$ = new BehaviorSubject<TaskWithSubTasks[]>([]);

    const storeSpy = jasmine.createSpyObj<Store>('Store', ['select', 'dispatch']);
    storeSpy.select.and.returnValue(repeatableTasks$.asObservable());

    const syncTriggerSpy = {
      afterInitialSyncDoneStrict$: of(true),
    };

    const globalTrackingSpy = {
      todayDateStr$: new BehaviorSubject(getDbDateStr(todayMs)),
    };

    const syncWrapperSpy = {
      afterCurrentSyncDoneOrSyncDisabled$: of(true),
    };

    const hydrationStateSpy = jasmine.createSpyObj<HydrationStateService>(
      'HydrationStateService',
      ['isInSyncWindow'],
      { isInSyncWindow$: of(false) },
    );
    hydrationStateSpy.isInSyncWindow.and.returnValue(false);

    const sidecarSpy = jasmine.createSpyObj<DeletedTaskIssueSidecarService>(
      'DeletedTaskIssueSidecarService',
      ['set'],
    );

    TestBed.configureTestingModule({
      providers: [
        TaskRepeatCleanupEffects,
        { provide: Store, useValue: storeSpy },
        { provide: SyncTriggerService, useValue: syncTriggerSpy },
        { provide: GlobalTrackingIntervalService, useValue: globalTrackingSpy },
        { provide: SyncWrapperService, useValue: syncWrapperSpy },
        { provide: HydrationStateService, useValue: hydrationStateSpy },
        { provide: DeletedTaskIssueSidecarService, useValue: sidecarSpy },
      ],
    });

    effects = TestBed.inject(TaskRepeatCleanupEffects);
    store = TestBed.inject(Store) as jasmine.SpyObj<Store>;
  });

  describe('cleanupDuplicateRepeatInstances$', () => {
    it("regression #7718: should NOT delete yesterday's UNTRACKED recurring instance when today's instance exists", fakeAsync(() => {
      const yesterdayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'yesterday-untracked',
        title: 'Untracked recurring task',
        repeatCfgId: 'cfg-1',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'today-fresh',
        title: 'Untracked recurring task',
        repeatCfgId: 'cfg-1',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayInstance),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext(
          'Bug #7718: legitimate previous-day overdue instance must remain so it shows in Overdue panel',
        )
        .toEqual([]);

      sub.unsubscribe();
    }));

    it("control: should NOT delete yesterday's TRACKED recurring instance when today's instance exists", fakeAsync(() => {
      const yesterdayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'yesterday-tracked',
        title: 'Tracked recurring task',
        repeatCfgId: 'cfg-2',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 15 * 60 * 1000,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'today-tracked',
        title: 'Tracked recurring task',
        repeatCfgId: 'cfg-2',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayInstance),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('Tracked overdue instances must never be cleaned up')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('still deletes genuine same-day duplicates (the original purpose of the cleanup)', fakeAsync(() => {
      // Simulates the sync-bug scenario this effect was built for: two instances
      // both created TODAY for the same repeatCfgId. Older one is stale.
      const olderToday: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'today-stale',
        title: 'Duplicate',
        repeatCfgId: 'cfg-3',
        created: todayMs - 60_000,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };
      const newerToday: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'today-newest',
        title: 'Duplicate',
        repeatCfgId: 'cfg-3',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([wrapWithSubTasks(olderToday), wrapWithSubTasks(newerToday)]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      // The older instance is removed; the newer one survives.
      expect(getDispatchedDeleteIds()).toEqual(['today-stale']);

      sub.unsubscribe();
    }));

    it('does nothing when only a single instance exists per repeatCfgId', fakeAsync(() => {
      const onlyInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'sole',
        repeatCfgId: 'cfg-4',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([wrapWithSubTasks(onlyInstance)]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds()).toEqual([]);

      sub.unsubscribe();
    }));
  });
});
