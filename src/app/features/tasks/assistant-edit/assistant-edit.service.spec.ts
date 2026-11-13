import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { AssistantEditOutcome, AssistantEditService } from './assistant-edit.service';
import { TaskService } from '../task.service';
import { TaskScheduleService } from '../task-schedule.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DateService } from '../../../core/date/date.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { setCurrentTask, unsetCurrentTask } from '../store/task.actions';
import { TASK_FEATURE_NAME, taskReducer } from '../store/task.reducer';
import { TAG_FEATURE_NAME, tagReducer } from '../../tag/store/tag.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectReducer,
} from '../../project/store/project.reducer';
import { plannerFeatureKey, plannerReducer } from '../../planner/store/planner.reducer';
import { ISSUE_PROVIDER_FEATURE_KEY } from '../../issue/store/issue-provider.reducer';
import { RootState } from '../../../root-store/root-state';
import { createCombinedTaskSharedMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/test-helpers';
import {
  createBaseState,
  createMockTask,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { Task, TaskReminderOptionId } from '../task.model';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * The service against the real task, tag, project and planner reducers and the
 * task-shared meta-reducers, so each case checks the state an edit leaves, not
 * only what it dispatched. TaskService is a thin stand-in that dispatches what
 * the real methods dispatch.
 */
describe('AssistantEditService', () => {
  let service: AssistantEditService;
  let state: RootState;
  let dispatched: Action[];
  let isApplyingRemoteOps: boolean;
  let hasPersistFailure: boolean;
  let flush: jasmine.Spy;
  let appFeatures: typeof DEFAULT_GLOBAL_CONFIG.appFeatures;
  let addTimeSpentAndSync: jasmine.Spy;

  const today = getDbDateStr();
  const OTHER_DAY = '2026-01-01';
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getDbDateStr(tomorrowDate);
  const at = (day: string, hours: number, minutes = 0): number => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, hours, minutes).getTime();
  };

  const seed = (tasks: Task[], issueProviders: unknown[] = []): void => {
    const base = createBaseState();
    state = {
      ...base,
      [TASK_FEATURE_NAME]: {
        ...base[TASK_FEATURE_NAME],
        ids: tasks.map((t) => t.id),
        entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
      },
      [PROJECT_FEATURE_NAME]: {
        ...base[PROJECT_FEATURE_NAME],
        entities: {
          project1: {
            ...base[PROJECT_FEATURE_NAME].entities.project1!,
            taskIds: tasks.filter((t) => !t.parentId).map((t) => t.id),
          },
        },
      },
      [ISSUE_PROVIDER_FEATURE_KEY]: {
        ids: issueProviders.map((_, i) => `ip${i}`),
        entities: Object.fromEntries(
          issueProviders.map((p, i) => [`ip${i}`, { id: `ip${i}`, ...(p as object) }]),
        ),
      },
    } as RootState;
  };
  const taskAfter = (id: string): Task => state[TASK_FEATURE_NAME].entities[id] as Task;
  const types = (): string[] => dispatched.map((a) => a.type);
  const rejectionOf = (outcome: AssistantEditOutcome): string | undefined =>
    'rejection' in outcome ? outcome.rejection : undefined;

  beforeEach(() => {
    dispatched = [];
    isApplyingRemoteOps = false;
    hasPersistFailure = false;
    appFeatures = { ...DEFAULT_GLOBAL_CONFIG.appFeatures, isTimeTrackingEnabled: true };
    seed([createMockTask({ id: 't1', title: 'Write report' })]);

    const coreReducer: ActionReducer<RootState, Action> = (current, action) => {
      const root = current ?? state;
      return {
        ...root,
        [TASK_FEATURE_NAME]: taskReducer(root[TASK_FEATURE_NAME], action),
        [TAG_FEATURE_NAME]: tagReducer(root[TAG_FEATURE_NAME], action),
        [PROJECT_FEATURE_NAME]: projectReducer(root[PROJECT_FEATURE_NAME], action),
        [plannerFeatureKey]: plannerReducer(root[plannerFeatureKey], action),
      };
    };
    const reducer = createCombinedTaskSharedMetaReducer(coreReducer);
    const store = {
      dispatch: (action: Action) => {
        dispatched.push(action);
        state = reducer(state, action);
      },
      select: <T>(selector: (s: RootState) => T) => of(selector(state)),
    };

    addTimeSpentAndSync = jasmine.createSpy('addTimeSpentAndSync');
    const taskService = {
      update: (id: string, changes: Partial<Task>, isIgnoreShortSyntax = false) =>
        store.dispatch(
          TaskSharedActions.updateTask({
            task: { id, changes },
            ...(isIgnoreShortSyntax && { isIgnoreShortSyntax }),
          }),
        ),
      scheduleTask: (task: Task, due: number, remindCfg: TaskReminderOptionId) =>
        store.dispatch(
          TaskSharedActions.scheduleTaskWithTime({
            task,
            dueWithTime: due,
            remindAt: remindOptionToMilliseconds(due, remindCfg),
            isMoveToBacklog: false,
          }),
        ),
      setCurrentId: (id: string | null) =>
        store.dispatch(id ? setCurrentTask({ id }) : unsetCurrentTask()),
      addTimeSpentAndSync,
    };
    flush = jasmine.createSpy('flushPendingWrites').and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        AssistantEditService,
        TaskScheduleService,
        { provide: Store, useValue: store },
        { provide: TaskService, useValue: taskService },
        {
          provide: HydrationStateService,
          useValue: { isApplyingRemoteOps: () => isApplyingRemoteOps },
        },
        {
          provide: OperationCaptureService,
          useValue: { hasUnrecoveredPersistFailure: () => hasPersistFailure },
        },
        { provide: OperationWriteFlushService, useValue: { flushPendingWrites: flush } },
        {
          provide: GlobalConfigService,
          useValue: { cfg: () => DEFAULT_GLOBAL_CONFIG, appFeatures: () => appFeatures },
        },
        {
          provide: DateService,
          useValue: {
            todayStr: () => today,
            isToday: (ts: number) => getDbDateStr(ts) === today,
            getStartOfNextDayDiffMs: () => 0,
          },
        },
      ],
    });
    service = TestBed.inject(AssistantEditService);
  });

  describe('updateTask', () => {
    it('moves a task with a start time to another day as the task menu does, keeping the time', async () => {
      seed([createMockTask({ id: 't1', dueWithTime: at(today, 15) })]);
      const outcome = await service.updateTask({ id: 't1', due: { day: tomorrow } });

      expect(types()).toEqual([TaskSharedActions.scheduleTaskWithTime.type]);
      expect(taskAfter('t1').dueWithTime).toBe(at(tomorrow, 15));
      expect(outcome).toEqual({
        result: { status: 'applied', task: jasmine.objectContaining({ id: 't1' }) },
      });
      expect(flush).toHaveBeenCalled();
    });

    it('plans an untimed task for a day, and for today through Today', async () => {
      await service.updateTask({ id: 't1', due: { day: tomorrow } });
      expect(taskAfter('t1').dueDay).toBe(tomorrow);

      await service.updateTask({ id: 't1', due: { day: today } });
      expect(taskAfter('t1').dueDay).toBe(today);
      expect(types()).toContain(TaskSharedActions.planTasksForToday.type);
    });

    it('leaves a task already planned for that day alone', async () => {
      seed([createMockTask({ id: 't1', dueDay: tomorrow })]);
      const outcome = await service.updateTask({ id: 't1', due: { day: tomorrow } });
      expect(dispatched).toEqual([]);
      expect('result' in outcome).toBeTrue();
    });

    it('gives a start time and unschedules with null', async () => {
      await service.updateTask({ id: 't1', due: { day: tomorrow, time: [9, 30] } });
      expect(taskAfter('t1').dueWithTime).toBe(at(tomorrow, 9, 30));

      await service.updateTask({ id: 't1', due: null });
      expect(taskAfter('t1').dueWithTime).toBeFalsy();
      expect(taskAfter('t1').dueDay).toBeFalsy();
      // Unscheduling an unscheduled task dispatches nothing.
      dispatched = [];
      await service.updateTask({ id: 't1', due: null });
      expect(dispatched).toEqual([]);
    });

    it('sets and removes a deadline like the deadline dialog, without snacks', async () => {
      await service.updateTask({ id: 't1', deadline: { day: tomorrow } });
      expect(taskAfter('t1').deadlineDay).toBe(tomorrow);
      expect(dispatched[0]).toEqual(
        jasmine.objectContaining({ isSkipSnack: true, deadlineDay: tomorrow }),
      );

      await service.updateTask({ id: 't1', deadline: { day: tomorrow, time: [17, 0] } });
      expect(taskAfter('t1').deadlineWithTime).toBe(at(tomorrow, 17));
      expect(taskAfter('t1').deadlineDay).toBeFalsy();

      await service.updateTask({ id: 't1', deadline: null });
      expect(taskAfter('t1').deadlineWithTime).toBeFalsy();
    });

    it('keeps a timed deadline reminder at the same lead time', async () => {
      seed([
        createMockTask({
          id: 't1',
          deadlineWithTime: at(tomorrow, 17),
          deadlineRemindAt: at(tomorrow, 16),
        }),
      ]);
      await service.updateTask({ id: 't1', deadline: { day: tomorrow, time: [18, 0] } });
      expect(taskAfter('t1').deadlineRemindAt).toBe(at(tomorrow, 17));
    });

    it('plans a task for today when its deadline is today', async () => {
      await service.updateTask({ id: 't1', deadline: { day: today } });
      expect(taskAfter('t1').dueDay).toBe(today);
    });

    it('stores a title literally in one update with the other fields', async () => {
      seed([createMockTask({ id: 't1' }), createMockTask({ id: 'other', tagIds: [] })]);
      await service.updateTask({
        id: 't1',
        title: 'Call Anna #work @tomorrow',
        isDone: true,
        estimateMinutes: 30,
        tagIds: [],
      });
      expect(dispatched).toEqual([
        TaskSharedActions.updateTask({
          task: {
            id: 't1',
            changes: {
              title: 'Call Anna #work @tomorrow',
              isDone: true,
              timeEstimate: 30 * 60000,
              tagIds: [],
            },
          },
          isIgnoreShortSyntax: true,
        }),
      ]);
      expect(taskAfter('t1').title).toBe('Call Anna #work @tomorrow');
      expect(taskAfter('t1').isDone).toBeTrue();
    });

    it('does not complete a done task again, which would move its completion date', async () => {
      seed([createMockTask({ id: 't1', isDone: true, doneOn: 1 })]);
      await service.updateTask({ id: 't1', isDone: true });
      expect(dispatched).toEqual([]);
      expect(taskAfter('t1').doneOn).toBe(1);
    });

    it('refuses guarded edits before dispatching anything', async () => {
      seed([
        createMockTask({ id: 'issue', issueId: 'JIRA-1', issueType: 'JIRA' }),
        createMockTask({ id: 'issueSub', parentId: 'issue', tagIds: [] }),
        createMockTask({ id: 'repeat', repeatCfgId: 'r1' }),
        createMockTask({ id: 'parent', subTaskIds: ['child'] }),
        createMockTask({ id: 'child', parentId: 'parent', tagIds: [] }),
      ]);
      const cases: [Parameters<AssistantEditService['updateTask']>[0], string][] = [
        [{ id: 'issue', title: 'leak' }, 'ISSUE_LINKED_TASK'],
        [{ id: 'issueSub', isDone: true }, 'ISSUE_LINKED_TASK'],
        [{ id: 'repeat', due: { day: tomorrow } }, 'RECURRING_TASK_SCHEDULE'],
        [{ id: 'parent', estimateMinutes: 10 }, 'PARENT_TASK_ESTIMATE'],
        [{ id: 'child', tagIds: ['TODAY'] }, 'TAG_NOT_FOUND'],
        [{ id: 'child', tagIds: ['nope'] }, 'TAG_NOT_FOUND'],
        [{ id: 'missing', isDone: true }, 'TASK_NOT_FOUND'],
      ];
      for (const [update, rejection] of cases) {
        expect(rejectionOf(await service.updateTask(update)))
          .withContext(JSON.stringify(update))
          .toBe(rejection);
      }
      expect(dispatched).toEqual([]);
      // A recurring task can still be completed, and given a deadline.
      expect(
        'result' in (await service.updateTask({ id: 'repeat', isDone: true })),
      ).toBeTrue();
    });

    it('refuses edits that would reach a calendar time-block', async () => {
      seed(
        [
          createMockTask({ id: 'timed', dueWithTime: at(tomorrow, 10) }),
          createMockTask({ id: 'untimed' }),
        ],
        [
          {
            issueProviderKey: 'plugin:calendar',
            isEnabled: true,
            pluginConfig: { isAutoTimeBlock: true },
          },
        ],
      );
      expect(rejectionOf(await service.updateTask({ id: 'timed', title: 'x' }))).toBe(
        'CALENDAR_LINKED_TASK',
      );
      expect(
        rejectionOf(
          await service.updateTask({
            id: 'untimed',
            due: { day: tomorrow, time: [9, 0] },
          }),
        ),
      ).toBe('CALENDAR_LINKED_TASK');
      expect(dispatched).toEqual([]);
      // Neither tags nor a day-only plan of an untimed task reach the calendar.
      await service.updateTask({ id: 'untimed', due: { day: tomorrow } });
      expect(taskAfter('untimed').dueDay).toBe(tomorrow);
    });

    it('waits while remote ops are applied and stops after a persist failure', async () => {
      isApplyingRemoteOps = true;
      expect(rejectionOf(await service.updateTask({ id: 't1', isDone: true }))).toBe(
        'APP_BUSY',
      );
      isApplyingRemoteOps = false;
      hasPersistFailure = true;
      expect(rejectionOf(await service.updateTask({ id: 't1', isDone: true }))).toBe(
        'PERSIST_DEGRADED',
      );
      expect(dispatched).toEqual([]);
    });

    it('reports an unknown outcome, never a failure, once dispatched', async () => {
      flush.and.rejectWith(new Error('idb'));
      expect(await service.updateTask({ id: 't1', isDone: true })).toEqual({
        result: { status: 'OUTCOME_UNKNOWN' },
      });
      expect(taskAfter('t1').isDone).toBeTrue();

      flush.and.callFake(async () => {
        hasPersistFailure = true;
      });
      expect(await service.updateTask({ id: 't1', title: 'New' })).toEqual({
        result: { status: 'OUTCOME_UNKNOWN' },
      });
    });
  });

  describe('tracking', () => {
    it('starts and stops tracking like the play and pause buttons', async () => {
      expect(await service.startTracking('t1')).toEqual({
        result: { status: 'applied', currentTaskId: 't1' },
      });
      expect(state[TASK_FEATURE_NAME].currentTaskId).toBe('t1');

      expect(await service.stopTracking()).toEqual({
        result: { status: 'applied', currentTaskId: null },
      });
      expect(state[TASK_FEATURE_NAME].currentTaskId).toBeNull();
    });

    it('refuses where the play button is hidden, and where it reaches outside', async () => {
      seed(
        [
          createMockTask({ id: 'done', isDone: true }),
          createMockTask({ id: 'parent', subTaskIds: ['child'] }),
          createMockTask({ id: 'child', parentId: 'parent', tagIds: [] }),
          createMockTask({ id: 'jira', issueId: 'J-1', issueType: 'JIRA' }),
        ],
        [],
      );
      expect(rejectionOf(await service.startTracking('done'))).toBe('CANNOT_TRACK_TASK');
      expect(rejectionOf(await service.startTracking('parent'))).toBe(
        'CANNOT_TRACK_TASK',
      );
      expect(rejectionOf(await service.startTracking('jira'))).toBe('ISSUE_LINKED_TASK');
      appFeatures = { ...appFeatures, isTimeTrackingEnabled: false };
      expect(rejectionOf(await service.startTracking('child'))).toBe(
        'TIME_TRACKING_DISABLED',
      );
      expect(dispatched).toEqual([]);
    });

    it('refuses to start while work sessions are logged to a calendar', async () => {
      seed(
        [createMockTask({ id: 't1' })],
        [
          {
            issueProviderKey: 'plugin:calendar',
            isEnabled: true,
            pluginConfig: { isLogWorkSessions: true },
          },
        ],
      );
      expect(rejectionOf(await service.startTracking('t1'))).toBe('CALENDAR_LINKED_TASK');
    });
  });

  describe('logTime', () => {
    it('adds time through the time dialog path', async () => {
      const outcome = await service.logTime({
        id: 't1',
        date: today,
        minutes: 25,
        mode: 'add',
      });
      expect(addTimeSpentAndSync).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ id: 't1' }),
        25 * 60000,
        today,
      );
      expect('result' in outcome).toBeTrue();
    });

    it("replaces a day's total and removes an emptied day", async () => {
      seed([
        createMockTask({ id: 't1', timeSpentOnDay: { [today]: 60000, [OTHER_DAY]: 5 } }),
      ]);
      await service.logTime({ id: 't1', date: today, minutes: 10, mode: 'set' });
      expect(taskAfter('t1').timeSpentOnDay[today]).toBe(10 * 60000);
      await service.logTime({ id: 't1', date: today, minutes: 0, mode: 'set' });
      expect(taskAfter('t1').timeSpentOnDay[today]).toBeUndefined();
      expect(taskAfter('t1').timeSpentOnDay[OTHER_DAY]).toBe(5);
    });

    it('refuses future days, more than a day, and parents', async () => {
      seed([
        createMockTask({ id: 'parent', subTaskIds: ['child'] }),
        createMockTask({
          id: 'child',
          parentId: 'parent',
          tagIds: [],
          timeSpentOnDay: { [today]: 23 * 3600000 },
        }),
      ]);
      expect(
        rejectionOf(
          await service.logTime({ id: 'child', date: tomorrow, minutes: 5, mode: 'add' }),
        ),
      ).toBe('INVALID_INPUT');
      expect(
        rejectionOf(
          await service.logTime({ id: 'child', date: today, minutes: 61, mode: 'add' }),
        ),
      ).toBe('INVALID_INPUT');
      expect(
        rejectionOf(
          await service.logTime({ id: 'parent', date: today, minutes: 5, mode: 'add' }),
        ),
      ).toBe('PARENT_TASK_TIME');
      expect(addTimeSpentAndSync).not.toHaveBeenCalled();
      expect(dispatched).toEqual([]);
    });
  });
});
