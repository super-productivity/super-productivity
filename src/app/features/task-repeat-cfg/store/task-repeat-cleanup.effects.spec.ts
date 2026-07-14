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
import {
  DEFAULT_TASK,
  Task,
  TaskReminderOptionId,
  TaskWithSubTasks,
} from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { selectAllTaskRepeatCfgs } from './task-repeat-cfg.selectors';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { DateService } from '../../../core/date/date.service';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { remindOptionToMilliseconds } from '../../tasks/util/remind-option-to-milliseconds';
import { TODAY_TAG } from '../../tag/tag.const';
import { TaskTimeSyncService } from '../../tasks/task-time-sync.service';

describe('TaskRepeatCleanupEffects', () => {
  let effects: TaskRepeatCleanupEffects;
  let store: jasmine.SpyObj<Store>;
  let repeatableTasks$: BehaviorSubject<TaskWithSubTasks[]>;
  let repeatCfgs$: BehaviorSubject<TaskRepeatCfg[]>;
  let taskTimeSync: jasmine.SpyObj<TaskTimeSyncService>;

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
    taskTimeSync = jasmine.createSpyObj('TaskTimeSyncService', ['clearOne']);

    TestBed.configureTestingModule({
      providers: [
        TaskRepeatCleanupEffects,
        { provide: Store, useValue: storeSpy },
        { provide: SyncTriggerService, useValue: syncTriggerSpy },
        { provide: GlobalTrackingIntervalService, useValue: globalTrackingSpy },
        { provide: SyncWrapperService, useValue: syncWrapperSpy },
        { provide: HydrationStateService, useValue: hydrationStateSpy },
        { provide: DeletedTaskIssueSidecarService, useValue: sidecarSpy },
        { provide: TaskTimeSyncService, useValue: taskTimeSync },
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
      expect(taskTimeSync.clearOne).toHaveBeenCalledOnceWith('today-stale');

      sub.unsubscribe();
    }));

    it('includes subtasks when deleting a duplicate parent instance', fakeAsync(() => {
      const staleSubtask: Task = {
        ...DEFAULT_TASK,
        id: 'stale-subtask',
        parentId: 'today-stale-parent',
        projectId: 'p1',
        title: 'Subtask',
        created: todayMs - 60_000,
        dueDay: getDbDateStr(todayMs),
      };
      const staleParent: TaskWithSubTasks = {
        ...DEFAULT_TASK,
        id: 'today-stale-parent',
        projectId: 'p1',
        title: 'Duplicate',
        repeatCfgId: 'cfg-with-subtask',
        created: todayMs - 60_000,
        dueDay: getDbDateStr(todayMs),
        subTaskIds: [staleSubtask.id],
        subTasks: [staleSubtask],
      };
      const newestParent = wrapWithSubTasks({
        ...DEFAULT_TASK,
        id: 'today-newest-parent',
        projectId: 'p1',
        title: 'Duplicate',
        repeatCfgId: 'cfg-with-subtask',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
      });
      repeatableTasks$.next([staleParent, newestParent]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      const deleteAction = store.dispatch.calls
        .allArgs()
        .map(
          ([action]) =>
            action as unknown as ReturnType<typeof TaskSharedActions.deleteTasks>,
        )
        .find((action) => action.type === TaskSharedActions.deleteTasks.type);
      expect(deleteAction?.taskIds).toEqual(['today-stale-parent']);
      expect(deleteAction?.tasks?.map(({ id }) => id)).toEqual([
        'today-stale-parent',
        'stale-subtask',
      ]);
      expect(taskTimeSync.clearOne.calls.allArgs()).toEqual([
        ['today-stale-parent'],
        ['stale-subtask'],
      ]);

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
    const skipOverdueCfg = (
      id: string,
      notes = '',
      overrides: Partial<TaskRepeatCfg> = {},
    ): TaskRepeatCfg =>
      ({
        ...DEFAULT_TASK_REPEAT_CFG,
        id,
        skipOverdue: true,
        notes,
        ...overrides,
      }) as TaskRepeatCfg;

    it("deletes yesterday's EMPTY overdue instance once today's instance exists", fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-so', '', { title: 'Water plants' })]);
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

    it("deletes yesterday's EMPTY timed overdue instance when schedule matches the template", fakeAsync(() => {
      const dueWithTime = getDateTimeFromClockString('09:00', yesterdayMs);
      repeatCfgs$.next([
        skipOverdueCfg('cfg-timed-template', '', {
          title: 'Water plants',
          startTime: '09:00',
          remindAt: TaskReminderOptionId.m15,
        }),
      ]);
      const yesterdayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'timed-template-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-timed-template',
        created: yesterdayMs,
        dueDay: undefined,
        dueWithTime,
        remindAt: remindOptionToMilliseconds(dueWithTime, TaskReminderOptionId.m15),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'timed-template-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-timed-template',
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

      expect(getDispatchedDeleteIds()).toEqual(['timed-template-yesterday']);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance whose schedule differs from the template', fakeAsync(() => {
      const editedDueWithTime = getDateTimeFromClockString('10:00', yesterdayMs);
      repeatCfgs$.next([
        skipOverdueCfg('cfg-schedule', '', {
          title: 'Water plants',
          startTime: '09:00',
          remindAt: TaskReminderOptionId.m15,
        }),
      ]);
      const yesterdayEdited: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'schedule-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-schedule',
        created: yesterdayMs,
        dueDay: undefined,
        dueWithTime: editedDueWithTime,
        remindAt: remindOptionToMilliseconds(editedDueWithTime, TaskReminderOptionId.m15),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'schedule-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-schedule',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayEdited),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with a user-edited schedule must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance with deadline metadata', fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-deadline', '', { title: 'Water plants' })]);
      const yesterdayEdited: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'deadline-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-deadline',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        deadlineDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'deadline-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-deadline',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayEdited),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with user-added deadline metadata must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('ignores TODAY_TAG when checking whether tags match the template', fakeAsync(() => {
      repeatCfgs$.next([
        skipOverdueCfg('cfg-today-tag', '', {
          title: 'Water plants',
          tagIds: [TODAY_TAG.id, 'tag-a'],
        }),
      ]);
      const yesterdayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'today-tag-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-today-tag',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
        tagIds: ['tag-a'],
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'today-tag-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-today-tag',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
        tagIds: ['tag-a'],
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayInstance),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds()).toEqual(['today-tag-yesterday']);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance whose title differs from the template', fakeAsync(() => {
      repeatCfgs$.next([skipOverdueCfg('cfg-title', '', { title: 'Water plants' })]);
      const yesterdayEdited: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'title-yesterday',
        title: 'Water plants - balcony',
        repeatCfgId: 'cfg-title',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'title-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-title',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayEdited),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with a user-edited title must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance whose estimate differs from the template', fakeAsync(() => {
      repeatCfgs$.next([
        skipOverdueCfg('cfg-estimate', '', {
          title: 'Water plants',
          defaultEstimate: 15 * 60 * 1000,
        }),
      ]);
      const yesterdayEdited: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'estimate-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-estimate',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
        timeEstimate: 30 * 60 * 1000,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'estimate-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-estimate',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
        timeEstimate: 15 * 60 * 1000,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayEdited),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with a user-edited estimate must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance whose tags differ from the template', fakeAsync(() => {
      repeatCfgs$.next([
        skipOverdueCfg('cfg-tags', '', { title: 'Water plants', tagIds: ['tag-a'] }),
      ]);
      const yesterdayEdited: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'tags-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-tags',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
        tagIds: ['tag-a', 'tag-user-added'],
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'tags-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-tags',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
        tagIds: ['tag-a'],
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayEdited),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with user-edited tags must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance whose subtask template was edited', fakeAsync(() => {
      repeatCfgs$.next([
        skipOverdueCfg('cfg-subtasks', '', {
          title: 'Water plants',
          shouldInheritSubtasks: true,
          subTaskTemplates: [{ title: 'Check soil', timeEstimate: 0, notes: '' }],
        }),
      ]);
      const yesterdayEdited = wrapWithSubTasks({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'subtasks-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-subtasks',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      } as Task);
      yesterdayEdited.subTasks.push({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'edited-subtask',
        title: 'Check dry soil',
        parentId: 'subtasks-yesterday',
        isDone: false,
        timeSpent: 0,
      } as Task);
      const todayInstance = wrapWithSubTasks({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'subtasks-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-subtasks',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      } as Task);
      todayInstance.subTasks.push({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'template-subtask',
        title: 'Check soil',
        parentId: 'subtasks-today',
        isDone: false,
        timeSpent: 0,
      } as Task);

      repeatableTasks$.next([yesterdayEdited, todayInstance]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance with user-edited subtasks must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance whose subtask has user metadata', fakeAsync(() => {
      repeatCfgs$.next([
        skipOverdueCfg('cfg-subtask-meta', '', {
          title: 'Water plants',
          shouldInheritSubtasks: true,
          subTaskTemplates: [{ title: 'Check soil', timeEstimate: 0, notes: '' }],
        }),
      ]);
      const yesterdayEdited = wrapWithSubTasks({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'subtask-meta-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-subtask-meta',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      } as Task);
      yesterdayEdited.subTasks.push({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'subtask-with-attachment',
        title: 'Check soil',
        parentId: 'subtask-meta-yesterday',
        isDone: false,
        timeSpent: 0,
        attachments: [{ id: 'sub-a1', type: 'LINK', path: 'https://x', title: 'x' }],
      } as Task);
      const todayInstance = wrapWithSubTasks({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'subtask-meta-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-subtask-meta',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      } as Task);
      todayInstance.subTasks.push({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'subtask-template',
        title: 'Check soil',
        parentId: 'subtask-meta-today',
        isDone: false,
        timeSpent: 0,
      } as Task);

      repeatableTasks$.next([yesterdayEdited, todayInstance]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('a parent with subtask user metadata must be preserved')
        .toEqual([]);

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

    it('keeps an overdue instance whose subtask was completed by the user', fakeAsync(() => {
      repeatCfgs$.next([
        skipOverdueCfg('cfg-sub-done', '', {
          title: 'Water plants',
          shouldInheritSubtasks: true,
          subTaskTemplates: [{ title: 'Check soil', timeEstimate: 0, notes: '' }],
        }),
      ]);
      const yesterdayWithDoneSub = wrapWithSubTasks({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'sub-done-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-sub-done',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      } as Task);
      // Title/notes/estimate match the template — only difference is the user
      // marked the subtask done. hasSubtaskProgress upstream of the unmodified
      // gate must keep the parent alive.
      yesterdayWithDoneSub.subTasks.push({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'done-subtask',
        title: 'Check soil',
        parentId: 'sub-done-yesterday',
        isDone: true,
        timeSpent: 0,
      } as Task);
      const todayInstance = wrapWithSubTasks({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'sub-done-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-sub-done',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      } as Task);
      todayInstance.subTasks.push({
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'today-subtask',
        title: 'Check soil',
        parentId: 'sub-done-today',
        isDone: false,
        timeSpent: 0,
      } as Task);

      repeatableTasks$.next([yesterdayWithDoneSub, todayInstance]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('a parent with a completed subtask must be preserved')
        .toEqual([]);

      sub.unsubscribe();
    }));

    it('keeps an overdue instance the user moved to a different project', fakeAsync(() => {
      // cfg has no projectId → the "did the user move it?" check falls back
      // to comparing against the newest instance's projectId. Moving the older
      // instance must look like a user edit and be preserved.
      repeatCfgs$.next([skipOverdueCfg('cfg-moved', '', { title: 'Water plants' })]);
      const yesterdayMoved: Task = {
        ...DEFAULT_TASK,
        projectId: 'p2',
        id: 'moved-yesterday',
        title: 'Water plants',
        repeatCfgId: 'cfg-moved',
        created: yesterdayMs,
        dueDay: getDbDateStr(yesterdayMs),
        isDone: false,
        timeSpent: 0,
      };
      const todayInstance: Task = {
        ...DEFAULT_TASK,
        projectId: 'p1',
        id: 'moved-today',
        title: 'Water plants',
        repeatCfgId: 'cfg-moved',
        created: todayMs,
        dueDay: getDbDateStr(todayMs),
        isDone: false,
        timeSpent: 0,
      };

      repeatableTasks$.next([
        wrapWithSubTasks(yesterdayMoved),
        wrapWithSubTasks(todayInstance),
      ]);

      const sub = effects.cleanupDuplicateRepeatInstances$.subscribe();
      tick(3001);

      expect(getDispatchedDeleteIds())
        .withContext('an instance moved to a different project must be preserved')
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
