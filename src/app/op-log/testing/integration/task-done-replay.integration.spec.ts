import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer } from '@ngrx/store';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { taskSharedCrudMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  createBaseState,
  createMockTask,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { RootState } from '../../../root-store/root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';
import { plannerFeatureKey } from '../../../features/planner/store/planner.reducer';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { LockService } from '../../sync/lock.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ImmediateUploadService } from '../../sync/immediate-upload.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';

describe('done task operation replay', () => {
  const TASK_ID = 'task-done-yesterday';
  const ACTION_TODAY = '2024-06-14';
  const REPLAY_TODAY = '2024-06-15';
  const DONE_TIMESTAMP = new Date(2024, 5, 14, 12, 0, 0, 0).getTime();

  const createState = (
    taskOverrides: Partial<Task> = {},
    todayStr = REPLAY_TODAY,
  ): RootState => {
    const base = createBaseState();
    const task = createMockTask({
      id: TASK_ID,
      isDone: false,
      doneOn: undefined,
      dueDay: undefined,
      dueWithTime: undefined,
      ...taskOverrides,
    });

    return {
      ...base,
      [TASK_FEATURE_NAME]: {
        ...base[TASK_FEATURE_NAME],
        ids: [TASK_ID],
        entities: { [TASK_ID]: task },
      },
      [appStateFeatureKey]: {
        ...base[appStateFeatureKey],
        todayStr,
        startOfNextDayDiffMs: 0,
      },
    };
  };

  const applyOperation = (state: RootState, op: Operation): RootState => {
    const passThroughReducer: ActionReducer<RootState, Action> = (s) => s as RootState;
    const reducer = bulkOperationsMetaReducer(
      taskSharedCrudMetaReducer(passThroughReducer),
    );
    return reducer(state, bulkApplyOperations({ operations: [op] }));
  };

  const createDoneOp = (changes: Partial<Task>, id = 'op-done-update'): Operation => ({
    id,
    actionType: ActionType.TASK_SHARED_UPDATE,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: TASK_ID,
    payload: {
      actionPayload: {
        task: { id: TASK_ID, changes: { isDone: true, ...changes } },
      },
      entityChanges: [],
    },
    clientId: 'clientA',
    vectorClock: { clientA: 1 },
    timestamp: DONE_TIMESTAMP,
    schemaVersion: 1,
  });

  const reduceLocalAction = (state: RootState, action: Action): RootState => {
    const passThroughReducer: ActionReducer<RootState, Action> = (s) => s as RootState;
    const reducer = taskSharedCrudMetaReducer(passThroughReducer);
    return reducer(state, action);
  };

  const persistLocalAction = async (action: Action): Promise<Operation> => {
    const actions$: Observable<Action> = of(action);
    const mockOpLogStore = jasmine.createSpyObj<OperationLogStoreService>(
      'OperationLogStoreService',
      ['appendWithVectorClockOverwrite', 'getCompactionCounter', 'clearVectorClockCache'],
    );
    const mockLockService = jasmine.createSpyObj<LockService>('LockService', ['request']);
    const mockVectorClockService = jasmine.createSpyObj<VectorClockService>(
      'VectorClockService',
      ['getCurrentVectorClock'],
    );
    const mockCompactionService = jasmine.createSpyObj<OperationLogCompactionService>(
      'OperationLogCompactionService',
      ['compact', 'emergencyCompact'],
    );
    const mockOperationCaptureService = jasmine.createSpyObj<OperationCaptureService>(
      'OperationCaptureService',
      ['extractEntityChanges', 'decrementPending'],
    );
    const mockSnackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const mockImmediateUploadService = jasmine.createSpyObj<ImmediateUploadService>(
      'ImmediateUploadService',
      ['trigger'],
    );
    const mockClientIdService = jasmine.createSpyObj<ClientIdService>('ClientIdService', [
      'getOrGenerateClientId',
    ]);
    const mockSuperSyncStatusService = jasmine.createSpyObj<SuperSyncStatusService>(
      'SuperSyncStatusService',
      ['updatePendingOpsStatus'],
    );

    mockLockService.request.and.callFake(async <T>(_name: string, fn: () => Promise<T>) =>
      fn(),
    );
    mockOpLogStore.appendWithVectorClockOverwrite.and.returnValue(Promise.resolve(1));
    mockOpLogStore.getCompactionCounter.and.returnValue(Promise.resolve(0));
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ clientA: 1 }),
    );
    mockCompactionService.compact.and.returnValue(Promise.resolve(true));
    mockCompactionService.emergencyCompact.and.returnValue(Promise.resolve(true));
    mockOperationCaptureService.extractEntityChanges.and.returnValue([]);
    mockClientIdService.getOrGenerateClientId.and.returnValue(Promise.resolve('clientA'));

    TestBed.configureTestingModule({
      providers: [
        OperationLogEffects,
        provideMockActions(() => actions$),
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: OperationLogCompactionService, useValue: mockCompactionService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: ImmediateUploadService, useValue: mockImmediateUploadService },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: OperationCaptureService, useValue: mockOperationCaptureService },
        { provide: SuperSyncStatusService, useValue: mockSuperSyncStatusService },
      ],
    });

    const effects = TestBed.inject(OperationLogEffects);
    await new Promise<void>((resolve, reject) => {
      effects.persistOperation$.subscribe({
        complete: resolve,
        error: reject,
      });
    });

    return mockOpLogStore.appendWithVectorClockOverwrite.calls.mostRecent()
      .args[0] as Operation;
  };

  const createScheduledState = (todayStr: string): RootState => {
    const scheduledDay = '2024-06-13';
    return {
      ...createState({ dueDay: scheduledDay }, todayStr),
      [plannerFeatureKey]: {
        days: { [scheduledDay]: [TASK_ID] },
        addPlannedTasksDialogLastShown: undefined,
      },
    };
  };

  const createTimedScheduledState = (todayStr: string): RootState => {
    const dueWithTime = new Date(2024, 5, 16, 9, 0, 0, 0).getTime();
    return {
      ...createState({ dueDay: undefined, dueWithTime }, todayStr),
      [plannerFeatureKey]: {
        days: {},
        addPlannedTasksDialogLastShown: undefined,
      },
    };
  };

  const getTodayTaskIds = (state: RootState): string[] =>
    (state[TAG_FEATURE_NAME].entities[TODAY_TAG.id] as Tag).taskIds;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('records only doneOn (never a dueDay) when replaying an unscheduled completion', () => {
    const op: Operation = {
      id: 'op-done-yesterday',
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: TASK_ID,
      payload: {
        actionPayload: {
          task: { id: TASK_ID, changes: { isDone: true } },
        },
        entityChanges: [],
      },
      clientId: 'clientA',
      vectorClock: { clientA: 1 },
      timestamp: DONE_TIMESTAMP,
      schemaVersion: 1,
    };

    const result = applyOperation(createState(), op);
    const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

    expect(task.isDone).toBe(true);
    expect(task.doneOn).toBe(DONE_TIMESTAMP);
    // Completion never synthesizes a dueDay: dueDay stays a pure planning field,
    // so local apply and replay both yield no dueDay for an unscheduled completion.
    expect(task.dueDay).toBeUndefined();
  });

  it('does not move an already scheduled task to the completion day during replay', () => {
    const scheduledDay = '2024-06-13';
    const initialState = createState();
    const stateWithScheduledTask: RootState = {
      ...initialState,
      [TASK_FEATURE_NAME]: {
        ...initialState[TASK_FEATURE_NAME],
        entities: {
          ...initialState[TASK_FEATURE_NAME].entities,
          [TASK_ID]: {
            ...(initialState[TASK_FEATURE_NAME].entities[TASK_ID] as Task),
            dueDay: scheduledDay,
          },
        },
      },
    };
    const op: Operation = {
      id: 'op-done-preserve-due-day',
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: TASK_ID,
      payload: {
        actionPayload: {
          task: { id: TASK_ID, changes: { isDone: true, doneOn: DONE_TIMESTAMP } },
        },
        entityChanges: [],
      },
      clientId: 'clientA',
      vectorClock: { clientA: 1 },
      timestamp: DONE_TIMESTAMP,
      schemaVersion: 1,
    };

    const result = applyOperation(stateWithScheduledTask, op);
    const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

    expect(task.isDone).toBe(true);
    expect(task.doneOn).toBe(DONE_TIMESTAMP);
    expect(task.dueDay).toBe(scheduledDay);
  });

  it('replays a doneOn-carrying unscheduled completion without synthesizing a dueDay', () => {
    const op: Operation = {
      id: 'op-done-on-only',
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: TASK_ID,
      payload: {
        actionPayload: {
          task: { id: TASK_ID, changes: { isDone: true, doneOn: DONE_TIMESTAMP } },
        },
        entityChanges: [],
      },
      clientId: 'clientA',
      vectorClock: { clientA: 1 },
      timestamp: DONE_TIMESTAMP,
      schemaVersion: 1,
    };

    const result = applyOperation(createState(), op);
    const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

    expect(task.isDone).toBe(true);
    expect(task.doneOn).toBe(DONE_TIMESTAMP);
    expect(task.dueDay).toBeUndefined();
  });

  it('ignores legacy synthetic completion dueDay when replaying onto a scheduled task', () => {
    const scheduledDay = '2024-06-13';
    const initialState = createState();
    const stateWithScheduledTask: RootState = {
      ...initialState,
      [TASK_FEATURE_NAME]: {
        ...initialState[TASK_FEATURE_NAME],
        entities: {
          ...initialState[TASK_FEATURE_NAME].entities,
          [TASK_ID]: {
            ...(initialState[TASK_FEATURE_NAME].entities[TASK_ID] as Task),
            dueDay: scheduledDay,
          },
        },
      },
    };
    const op: Operation = {
      id: 'op-legacy-bad-due-day',
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: TASK_ID,
      payload: {
        actionPayload: {
          task: {
            id: TASK_ID,
            changes: {
              isDone: true,
              doneOn: DONE_TIMESTAMP,
              dueDay: ACTION_TODAY,
            },
          },
        },
        entityChanges: [],
      },
      clientId: 'clientA',
      vectorClock: { clientA: 1 },
      timestamp: DONE_TIMESTAMP,
      schemaVersion: 1,
    };

    const result = applyOperation(stateWithScheduledTask, op);
    const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

    expect(task.isDone).toBe(true);
    expect(task.doneOn).toBe(DONE_TIMESTAMP);
    expect(task.dueDay).toBe(scheduledDay);
  });

  it('handles legacy synthetic completion dueDay replay across schedule states', () => {
    const dueWithTime = new Date(2024, 5, 16, 9, 0, 0, 0).getTime();
    const legacyOp = createDoneOp(
      {
        doneOn: DONE_TIMESTAMP,
        dueDay: ACTION_TODAY,
      },
      'op-legacy-synthetic-due-day-matrix',
    );
    const cases: {
      description: string;
      taskOverrides: Partial<Task>;
      expectedDueDay: string | undefined;
      expectedDueWithTime?: number;
    }[] = [
      {
        description: 'existing dueDay is preserved',
        taskOverrides: { dueDay: '2024-06-13' },
        expectedDueDay: '2024-06-13',
      },
      {
        description: 'existing dueWithTime is preserved',
        taskOverrides: { dueWithTime },
        expectedDueDay: undefined,
        expectedDueWithTime: dueWithTime,
      },
      {
        description: 'unscheduled main task keeps legacy completion dueDay',
        taskOverrides: {},
        expectedDueDay: ACTION_TODAY,
      },
      {
        description: 'unscheduled subtask drops legacy completion dueDay',
        taskOverrides: { parentId: 'parent-task' },
        expectedDueDay: undefined,
      },
      {
        description: 'schedule matching completion day is preserved',
        taskOverrides: { dueDay: ACTION_TODAY },
        expectedDueDay: ACTION_TODAY,
      },
    ];

    for (const {
      description,
      taskOverrides,
      expectedDueDay,
      expectedDueWithTime,
    } of cases) {
      const result = applyOperation(createState(taskOverrides), legacyOp);
      const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

      expect(task.isDone).withContext(description).toBe(true);
      expect(task.doneOn).withContext(description).toBe(DONE_TIMESTAMP);
      expect(task.dueDay).withContext(description).toBe(expectedDueDay);
      if (expectedDueWithTime !== undefined) {
        expect(task.dueWithTime).withContext(description).toBe(expectedDueWithTime);
      }
    }
  });

  it('round-trips a locally captured scheduled completion without schedule drift', async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(DONE_TIMESTAMP));

    try {
      const action = TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes: { isDone: true } },
      });
      const localResult = reduceLocalAction(createScheduledState(ACTION_TODAY), action);
      const persistedOp = await persistLocalAction(action);
      const replayResult = applyOperation(
        createScheduledState(REPLAY_TODAY),
        persistedOp,
      );

      const localTask = localResult[TASK_FEATURE_NAME].entities[TASK_ID] as Task;
      const replayTask = replayResult[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

      expect(persistedOp.actionType).toBe(ActionType.TASK_SHARED_UPDATE);
      expect(localTask.doneOn).toBe(DONE_TIMESTAMP);
      expect(replayTask.doneOn).toBe(localTask.doneOn);
      expect(replayTask.dueDay).toBe(localTask.dueDay);
      expect(replayTask.dueWithTime).toBe(localTask.dueWithTime);
      expect(getTodayTaskIds(replayResult)).toEqual(getTodayTaskIds(localResult));
      expect(replayResult[plannerFeatureKey].days).toEqual(
        localResult[plannerFeatureKey].days,
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('round-trips a locally captured timed completion without schedule drift', async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(DONE_TIMESTAMP));

    try {
      const action = TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes: { isDone: true } },
      });
      const localResult = reduceLocalAction(
        createTimedScheduledState(ACTION_TODAY),
        action,
      );
      const persistedOp = await persistLocalAction(action);
      const replayResult = applyOperation(
        createTimedScheduledState(REPLAY_TODAY),
        persistedOp,
      );

      const localTask = localResult[TASK_FEATURE_NAME].entities[TASK_ID] as Task;
      const replayTask = replayResult[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

      expect(persistedOp.actionType).toBe(ActionType.TASK_SHARED_UPDATE);
      expect(localTask.doneOn).toBe(DONE_TIMESTAMP);
      expect(replayTask.doneOn).toBe(localTask.doneOn);
      expect(replayTask.dueDay).toBeUndefined();
      expect(replayTask.dueWithTime).toBe(localTask.dueWithTime);
      expect(getTodayTaskIds(replayResult)).toEqual(getTodayTaskIds(localResult));
      expect(replayResult[plannerFeatureKey].days).toEqual(
        localResult[plannerFeatureKey].days,
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
