import { fieldPatchGroups } from '../../op-log/sync/conflict-field-patch.util';
import { ActionType, OpType, Operation } from '../../op-log/core/operation.types';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, Subject, tap } from 'rxjs';
import { Router } from '@angular/router';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { DEFAULT_DATE_INPUT_LOCALE } from '../../core/date-time-format/date-input-locale';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { SnackService } from '../../core/snack/snack.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { ArchiveOperationHandler } from '../../op-log/apply/archive-operation-handler.service';
import { RootState } from '../../root-store/root-state';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { createCombinedTaskSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/test-helpers';
import {
  createBaseState,
  createStateWithExistingTasks,
} from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { shortSyntaxSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/short-syntax-shared.reducer';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { getDbDateStr } from '../../util/get-db-date-str';
import { ArchiveService } from '../archive/archive.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { GlobalConfigService } from '../config/global-config.service';
import { IssueSharedTitleService } from '../issue/two-way-sync/issue-shared-title.service';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { LocalRestApiFeatureBridgeService } from './local-rest-api-feature-bridge.service';
import { LocalRestApiTaskRoutesService } from './local-rest-api-task-routes.service';
import { ShortSyntaxEffects } from './store/short-syntax.effects';
import { TASK_FEATURE_NAME, taskReducer } from './store/task.reducer';
import { TaskFocusService } from './task-focus.service';
import { TaskService } from './task.service';
import { DEFAULT_TASK, Task } from './task.model';
import { TaskTimeSyncService } from './task-time-sync.service';
import { MatDialog } from '@angular/material/dialog';

describe('REST reminder creation integration', () => {
  it('does not drop a deadline when resolving a concurrent notes edit', () => {
    const task: Task = {
      ...DEFAULT_TASK,
      id: 'task-1',
      title: 'Task',
      projectId: 'project1',
    };
    const update = TaskSharedActions.updateTask({
      task: { id: task.id, changes: { remindAt: 123 } },
    });
    const deadline = TaskSharedActions.setDeadline({
      taskId: task.id,
      deadlineDay: '2099-11-05',
    });
    const notes = TaskSharedActions.updateTask({
      task: { id: task.id, changes: { notes: 'Concurrent note' } },
    });
    const toOp = (
      action: typeof update | typeof deadline,
      id: string,
      clientId: string,
      timestamp: number,
    ): Operation => {
      const { type, meta, ...actionPayload } = action;
      return {
        id,
        actionType: type as ActionType,
        opType: meta.opType,
        entityType: 'TASK',
        entityId: task.id,
        payload: {
          actionPayload,
          entityChanges:
            action.type === TaskSharedActions.setDeadline.type
              ? [
                  {
                    entityType: 'TASK',
                    entityId: task.id,
                    opType: OpType.Update,
                    changes: { deadlineDay: '2099-11-05' },
                  },
                ]
              : [],
        },
        clientId,
        timestamp,
        vectorClock: { [clientId]: timestamp },
        schemaVersion: 1,
      };
    };
    const groups = fieldPatchGroups({
      localOps: [toOp(deadline, 'a1', 'A', 1), toOp(update, 'a2', 'A', 2)],
      remoteOps: [toOp(notes, 'b1', 'B', 3)],
      payloadKey: 'task',
      entityId: task.id,
    });
    expect(groups).toBeDefined();
    expect(
      groups?.some((group) => group.changes['deadlineDay'] === '2099-11-05'),
    ).toBeTrue();
  });

  it('matches deadline planning followed by an explicit reminder, including serialized replay', () => {
    const today = getDbDateStr();
    const task: Task = {
      ...DEFAULT_TASK,
      id: 'task-1',
      title: 'Task',
      projectId: 'project1',
      dueWithTime: Date.now() - 172800000,
      remindAt: 100,
      deadlineRemindAt: 200,
    };
    const initial = createStateWithExistingTasks(['task-1'], [], [], []);
    initial[TASK_FEATURE_NAME].entities['task-1'] = task;
    const reduce = createCombinedTaskSharedMetaReducer(
      shortSyntaxSharedMetaReducer((current) => current),
    );
    const context = { autoPlanToday: today, autoPlanStartOfNextDayDiffMs: 0 };
    const deadline = TaskSharedActions.setDeadline({
      taskId: task.id,
      deadlineDay: today,
      ...context,
    });
    const reminderUpdate = TaskSharedActions.updateTask({
      task: { id: task.id, changes: { remindAt: 123 } },
    });
    const afterDeadline = reduce(initial, deadline);
    expect(afterDeadline[TASK_FEATURE_NAME].entities[task.id]?.dueDay).toBe(today);
    expect(afterDeadline[TASK_FEATURE_NAME].entities[task.id]?.remindAt).toBeUndefined();
    const actual = reduce(afterDeadline, reminderUpdate);
    const replay = [deadline, reminderUpdate].reduce(
      (current, action) => reduce(current, JSON.parse(JSON.stringify(action))),
      initial,
    );
    // updateTask changes modified timestamps; only compare persisted reminder
    // and scheduling contract fields instead of test-clock-derived metadata.
    for (const result of [actual, replay]) {
      const saved = result[TASK_FEATURE_NAME].entities[task.id];
      expect(saved?.deadlineDay).toBe(today);
      expect(saved?.dueDay).toBe(today);
      expect(saved?.dueWithTime).toBeUndefined();
      expect(saved?.remindAt).toBe(123);
    }
  });

  it('creates the task and preserves its reminder through deadline planning and asynchronous short syntax', async () => {
    let state = createBaseState();
    const today = getDbDateStr();
    const actions$ = new Subject<Action>();
    const actions: Action[] = [];
    let afterDeadline: Task | undefined;
    const date = { todayStr: () => today, getStartOfNextDayDiffMs: () => 0 };
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({ initialState: state }),
        TaskService,
        ShortSyntaxEffects,
        LocalRestApiTaskRoutesService,
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextType: WorkContextType.PROJECT,
            activeWorkContextId: 'project1',
            startableTasksForActiveContext: signal([]),
          },
        },
        { provide: DateService, useValue: date },
        {
          provide: DateTimeFormatService,
          useValue: { dateInputLocale: () => DEFAULT_DATE_INPUT_LOCALE },
        },
        { provide: GlobalTrackingIntervalService, useValue: { tick$: new Subject() } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: ArchiveService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: ArchiveOperationHandler, useValue: {} },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal(DEFAULT_GLOBAL_CONFIG),
            tasks$: of({ ...DEFAULT_GLOBAL_CONFIG.tasks, defaultProjectId: null }),
            appFeatures: signal(DEFAULT_GLOBAL_CONFIG.appFeatures),
          },
        },
        {
          provide: TaskFocusService,
          useValue: { lastFocusedTaskComponent: signal(null) },
        },
        { provide: ImexViewService, useValue: { isDataImportInProgress$: of(false) } },
        {
          provide: TaskTimeSyncService,
          useValue: { flushOne: () => {}, flush: () => {} },
        },
        { provide: LocalRestApiFeatureBridgeService, useValue: {} },
        {
          provide: ProjectService,
          useValue: { list$: of([]), list: () => [], getByIdOnce$: () => of(undefined) },
        },
        { provide: TagService, useValue: { tagsNoMyDayAndNoList$: of([]) } },
        { provide: SnackService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: LayoutService, useValue: {} },
        { provide: IssueSharedTitleService, useValue: {} },
      ],
    });
    const store = TestBed.inject(MockStore);
    const reducer = createCombinedTaskSharedMetaReducer(
      shortSyntaxSharedMetaReducer((current: RootState, action: Action) => ({
        ...current,
        [TASK_FEATURE_NAME]: taskReducer(current[TASK_FEATURE_NAME], action),
      })),
    );
    spyOn(store, 'dispatch');
    (store.dispatch as jasmine.Spy).and.callFake((action: Action) => {
      actions.push(action);
      state = reducer(state, action);
      if (action.type === TaskSharedActions.setDeadline.type) {
        const deadline = action as ReturnType<typeof TaskSharedActions.setDeadline>;
        afterDeadline = state[TASK_FEATURE_NAME].entities[deadline.taskId];
      }
      store.setState(state);
      actions$.next(action);
    });
    const effect = TestBed.inject(ShortSyntaxEffects);
    const parsed = firstValueFrom(
      effect.shortSyntax$.pipe(tap((action) => store.dispatch(action))),
    );
    const reminder = Date.now() + 3600000;
    const due = Date.now() - 172800000;
    const result = await TestBed.inject(LocalRestApiTaskRoutesService).handle({
      requestId: 'request',
      method: 'POST',
      path: '/tasks',
      query: {},
      body: {
        title: 'Call @tomorrow 15:00',
        dueWithTime: due,
        deadlineDay: today,
        remindAt: reminder,
      },
    });
    expect(result?.status).toBe(201);
    await parsed;
    const added = actions.find(
      (action) => action.type === TaskSharedActions.addTask.type,
    ) as ReturnType<typeof TaskSharedActions.addTask>;
    expect(added).toBeDefined();
    expect(afterDeadline?.dueDay).toBe(today);
    expect(afterDeadline?.dueWithTime).toBeUndefined();
    expect(afterDeadline?.remindAt).toBeUndefined();
    expect(
      actions.filter((action) => action.type === TaskSharedActions.applyShortSyntax.type)
        .length,
    ).toBe(1);
    expect(actions.map((action) => action.type)).toEqual([
      TaskSharedActions.addTask.type,
      TaskSharedActions.setDeadline.type,
      TaskSharedActions.updateTask.type,
      TaskSharedActions.applyShortSyntax.type,
    ]);
    const syntaxActions = actions.filter(
      (action) => action.type === TaskSharedActions.applyShortSyntax.type,
    ) as ReturnType<typeof TaskSharedActions.applyShortSyntax>[];
    const parsedSchedule = syntaxActions.find(
      (action) => action.schedulingInfo?.dueWithTime,
    );
    expect(parsedSchedule?.schedulingInfo?.dueWithTime).toEqual(jasmine.any(Number));
    expect(state[TASK_FEATURE_NAME].entities[added.task.id]?.dueWithTime).toBe(
      parsedSchedule?.schedulingInfo?.dueWithTime,
    );
    expect(state[TASK_FEATURE_NAME].entities[added.task.id]?.remindAt).toBe(reminder);
    const replayed = actions.reduce(
      (current, action) => reducer(current, JSON.parse(JSON.stringify(action))),
      createBaseState(),
    );
    expect(replayed[TASK_FEATURE_NAME].entities[added.task.id]?.remindAt).toBe(reminder);
    expect(replayed[TASK_FEATURE_NAME].entities[added.task.id]?.dueWithTime).toBe(
      parsedSchedule?.schedulingInfo?.dueWithTime,
    );
  });
});
