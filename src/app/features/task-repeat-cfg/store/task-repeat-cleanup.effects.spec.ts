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
import { selectAllTaskRepeatCfgs } from './task-repeat-cfg.selectors';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { DateService } from '../../../core/date/date.service';

describe('TaskRepeatCleanupEffects', () => {
  let effects: TaskRepeatCleanupEffects;
  let store: jasmine.SpyObj<Store>;
  let repeatableTasks$: BehaviorSubject<TaskWithSubTasks[]>;
  let repeatCfgs$: BehaviorSubject<TaskRepeatCfg[]>;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayMs = new Date().setHours(12, 0, 0, 0);
  const yesterdayMs = todayMs - DAY_MS;
  const tomorrowMs = todayMs + DAY_MS;

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
    repeatCfgs$ = new BehaviorSubject<TaskRepeatCfg[]>([]);

    const storeSpy = jasmine.createSpyObj<Store>('Store', ['select', 'dispatch']);
    storeSpy.select.and.callFake((selector: unknown) =>
      selector === selectAllTaskRepeatCfgs
        ? (repeatCfgs$.asObservable() as ReturnType<Store['select']>)
        : (repeatableTasks$.asObservable() as ReturnType<Store['select']>),
    );

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
        { provide: DateService, useValue: { todayStr: () => getDbDateStr(todayMs) } },
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

  describe('skipOverdue cross-day cleanup (#7977)', () => {
    const skipOverdueCfg = (id: string, notes = ''): TaskRepeatCfg =>
      ({ ...DEFAULT_TASK_REPEAT_CFG, id, skipOverdue: true, notes }) as TaskRepeatCfg;

    it("deletes yesterday's EMPTY overdue instance once today's instance exists", fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-so')]);
      const yesterdayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'so-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-so',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'so-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-so',
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
        .withContext('the empty stale overdue instance is removed, today survives')
        .toEqual(['so-yesterday']);

      sub.unsubscribe();
    }));

    it("keeps yesterday's TRACKED instance even with skipOverdue (never destroy work)", fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-so2')]);
      const yesterdayTracked: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'so2-yesterday',
        repeatCfgId: 'cfg-so2',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 15 * 60 * 1000,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'so2-today',
        repeatCfgId: 'cfg-so2',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayTracked),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with tracked time is preserved as overdue')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('does nothing for a single overdue instance (no newer one yet)', fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-so3')]);
      const onlyOverdue: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'so3-only',
        repeatCfgId: 'cfg-so3',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([wrapWithSubTasks(onlyOverdue)]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('the sole instance must not be deleted')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it("does NOT delete today's instance when a planned-ahead future instance exists", fakeAsync(() => {
      // Review finding: survivor was picked by max(created); a tomorrow instance
      // (created later) would otherwise make today's empty instance the "older"
      // one and get it deleted. Only genuinely overdue instances may be reaped.
      repeatCfgs$.next([skipOverdueCfg('cfg-fut')]);
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'fut-today',
        repeatCfgId: 'cfg-fut',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };
      const tomorrowInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'fut-tomorrow',
        repeatCfgId: 'cfg-fut',
        created: tomorrowMs,
        dueDay: getDbDateStr(tomorrowMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(todayInstance),
        wrapWithSubTasks(tomorrowInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext("today's and future instances are never reaped")
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance whose notes differ from the template', fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-notes', 'template note')]);
      const yesterdayEdited: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'notes-yesterday',
        repeatCfgId: 'cfg-notes',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
        notes: 'I jotted something here',
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'notes-today',
        repeatCfgId: 'cfg-notes',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
        notes: 'template note',
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayEdited),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance the user added notes to must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance with attachments', fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-att')]);
      const yesterdayWithAttachment: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'att-yesterday',
        repeatCfgId: 'cfg-att',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
        attachments: [{ id: 'a1', type: 'LINK', path: 'https://x', title: 'x' }],
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'att-today',
        repeatCfgId: 'cfg-att',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayWithAttachment),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with an attachment must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('does not touch instances of configs WITHOUT skipOverdue (#7718 still holds)', fakeAsync(() => {
      // cfg present but skipOverdue is false -> default behavior, keep overdue
      repeatCfgs$.next([
        {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'cfg-plain',
          skipOverdue: false,
        } as TaskRepeatCfg,
      ]);
      const yesterdayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'plain-yesterday',
        repeatCfgId: 'cfg-plain',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'plain-today',
        repeatCfgId: 'cfg-plain',
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
        .withContext('without skipOverdue the previous-day instance must survive')
        .toEqual([]);

      sub.unsubscribe();
    }));
  });
});
