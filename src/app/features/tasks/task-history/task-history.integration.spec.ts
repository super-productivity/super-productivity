import { ActionReducer } from '@ngrx/store';
import { META_REDUCERS } from '../../../root-store/meta/meta-reducer-registry';
import { RootState } from '../../../root-store/root-state';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  createMockTask,
  createStateWithExistingTasks,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { taskReducer } from '../store/task.reducer';
import {
  setIsApplyingRemoteOps,
  setOperationCaptureService,
  clearDeferredActions,
} from '../../../op-log/capture/operation-capture.meta-reducer';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import {
  peekTaskHistoryCapture,
  releaseTaskHistoryCapture,
} from '../../../op-log/capture/task-history-capture';
import { bulkApplyOperations } from '../../../op-log/apply/bulk-hydration.action';
import { Operation, ActionType } from '../../../op-log/core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../../../op-log/persistence/schema-migration.service';
import { PersistentAction } from '../../../op-log/core/persistent-action.interface';
import { validateOperationPayload } from '../../../op-log/validation/validate-operation-payload';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { MODEL_CONFIGS, AppDataComplete } from '../../../op-log/model/model-config';
import { TaskHistoryEnvelope, TaskHistoryEvent } from './task-history.model';
import { collectTaskHistory, mergeTaskHistory } from './task-history.util';
import {
  upsertPluginUserData,
  deletePluginUserData,
} from '../../../plugins/store/plugin.actions';
import { TASK_HISTORY_DELIVERY_PREFIX } from './task-history-delivery';
import { toLwwUpdateActionType } from '../../../op-log/core/lww-update-action-types';

describe('Task history through real task reducers and operation replay', () => {
  let reduce: ActionReducer<RootState>;
  let initial: RootState;
  beforeEach(() => {
    setOperationCaptureService(new OperationCaptureService());
    setIsApplyingRemoteOps(false);
    const root: ActionReducer<RootState> = (state, action) => ({
      ...state!,
      tasks: taskReducer(state?.tasks, action),
    });
    reduce = META_REDUCERS.reduceRight((inner, meta) => meta(inner), root);
    initial = createStateWithExistingTasks(['parent', 'child', 'sibling']);
    initial.tasks = {
      ...initial.tasks,
      entities: {
        ...initial.tasks.entities,
        parent: createMockTask({ id: 'parent', tagIds: [], subTaskIds: ['child'] }),
        child: createMockTask({ id: 'child', tagIds: [], parentId: 'parent' }),
      },
    };
  });
  afterEach(() => {
    setOperationCaptureService(null);
    setIsApplyingRemoteOps(false);
    clearDeferredActions();
  });
  const events = (state: RootState, id = 'parent'): TaskHistoryEvent[] =>
    Object.values(state.tasks.taskHistory?.[id]?.events ?? {});
  const operation = (action: PersistentAction): Operation => {
    const capture = peekTaskHistoryCapture(action)!;
    const { type, meta, ...payload } = action;
    return JSON.parse(
      JSON.stringify({
        id: capture.operationId,
        actionType: type as ActionType,
        entityType: meta.entityType,
        entityId: meta.entityId,
        entityIds: meta.entityIds,
        opType: meta.opType,
        clientId: 'synthetic-author',
        timestamp: capture.occurredAt,
        vectorClock: { syntheticAuthor: 1 },
        schemaVersion: CURRENT_SCHEMA_VERSION,
        payload: {
          actionPayload: { ...payload, taskHistory: capture.envelope },
          entityChanges: [],
        },
      }),
    ) as Operation;
  };
  const update = (
    id: string,
    changes: Parameters<typeof TaskSharedActions.updateTask>[0]['task']['changes'],
  ): PersistentAction => TaskSharedActions.updateTask({ task: { id, changes } });

  it('records old/new planning and deadline values separately, keeping the parent unrelated', () => {
    const action = update('child', { dueDay: '2026-10-31', deadlineDay: '2026-11-02' });
    const state = reduce(initial, action);
    expect(events(state)).toEqual([]);
    expect(events(state, 'sibling')).toEqual([]);
    expect(events(state, 'child').map((e) => [e.field, e.before, e.after])).toEqual([
      ['schedule', { kind: 'none' }, { kind: 'day', value: '2026-10-31' }],
      ['deadline', { kind: 'none' }, { kind: 'day', value: '2026-11-02' }],
    ]);
    expect(initial.tasks.taskHistory).toBeUndefined();
  });

  it('reuses event maps for untracked edits and duplicate replay, then appends immutably', () => {
    const firstAction = update('child', { dueDay: '2026-11-01' });
    const first = reduce(initial, firstAction);
    const firstEvents = first.tasks.taskHistory!.child.events;
    const renamed = reduce(first, update('child', { title: 'Renamed task' }));
    expect(renamed.tasks.taskHistory!.child.events).toBe(firstEvents);

    const replayed = reduce(
      renamed,
      bulkApplyOperations({ operations: [operation(firstAction)] }),
    );
    expect(replayed.tasks.taskHistory!.child.events).toBe(firstEvents);

    const changed = reduce(replayed, update('child', { deadlineDay: '2026-11-02' }));
    expect(changed.tasks.taskHistory!.child.events).not.toBe(firstEvents);
    expect(Object.keys(firstEvents)).toHaveSize(1);
    expect(events(changed, 'child')).toHaveSize(2);
  });

  it('preserves existing events when an earlier baseline arrives with a new event', () => {
    const first = reduce(initial, update('child', { dueDay: '2026-11-01' }));
    const history = first.tasks.taskHistory!;
    const before = first.tasks;
    const after = {
      ...before,
      entities: {
        ...before.entities,
        child: { ...before.entities.child!, deadlineDay: '2026-11-02' },
      },
    };
    const envelope = collectTaskHistory(before, after, 'earlier-author', 1, 'update');
    envelope.baselines = envelope.baselines.map((baseline) => ({
      ...baseline,
      id: 'earlier-author:child:baseline',
      observedAt: 1,
    }));
    const merged = mergeTaskHistory(history, envelope)!;
    expect(merged.child.baseline!.observedAt).toBe(1);
    expect(Object.keys(history.child.events)).toHaveSize(1);
    expect(Object.keys(merged.child.events)).toHaveSize(2);
    expect(merged.child.events).not.toBe(history.child.events);
  });

  it('covers native deadline actions omitted by the existing plugin update hook', () => {
    const add = TaskSharedActions.setDeadline({
      taskId: 'parent',
      deadlineDay: '2026-11-01',
    });
    const set = reduce(initial, add);
    const remove = TaskSharedActions.removeDeadline({ taskId: 'parent' });
    const cleared = reduce(set, remove);
    expect(events(cleared).map((e) => e.after)).toEqual([
      { kind: 'day', value: '2026-11-01' },
      { kind: 'none' },
    ]);
    expect(cleared.tasks.entities.parent!.deadlineDay).toBeUndefined();
  });

  it('records time -> day -> cleared scheduling without confusing it with a deadline', () => {
    let state = reduce(initial, update('child', { dueWithTime: 1793462400000 }));
    state = reduce(state, update('child', { dueWithTime: null, dueDay: '2026-11-01' }));
    state = reduce(state, update('child', { dueDay: null }));
    expect(events(state, 'child').map((e) => [e.field, e.after])).toEqual([
      ['schedule', { kind: 'time', value: 1793462400000 }],
      ['schedule', { kind: 'day', value: '2026-11-01' }],
      ['schedule', { kind: 'none' }],
    ]);
  });

  it('keeps exact timed deadline transitions separate from scheduling and task status', () => {
    const time = 1793620800000;
    const timed = reduce(
      initial,
      TaskSharedActions.setDeadline({ taskId: 'parent', deadlineWithTime: time }),
    );
    const day = reduce(
      timed,
      TaskSharedActions.setDeadline({ taskId: 'parent', deadlineDay: '2026-11-04' }),
    );
    const cleared = reduce(day, TaskSharedActions.removeDeadline({ taskId: 'parent' }));
    expect(
      events(cleared).map((event) => [event.field, event.before, event.after]),
    ).toEqual([
      ['deadline', { kind: 'none' }, { kind: 'time', value: time }],
      ['deadline', { kind: 'time', value: time }, { kind: 'day', value: '2026-11-04' }],
      ['deadline', { kind: 'day', value: '2026-11-04' }, { kind: 'none' }],
    ]);
    expect(cleared.tasks.entities.parent!.isDone).toBe(false);
    expect(cleared.tasks.entities.parent!.dueWithTime).toBe(
      initial.tasks.entities.parent!.dueWithTime,
    );
    expect(cleared.tasks.entities.parent!.dueDay).toBe(
      initial.tasks.entities.parent!.dueDay,
    );
  });

  it('records each changed task in a native plugin batch under one operation ID', () => {
    const action = TaskSharedActions.batchUpdateForProject({
      projectId: 'project1',
      operations: [
        { type: 'update', taskId: 'child', updates: { isDone: true } },
        { type: 'update', taskId: 'sibling', updates: { isDone: true } },
      ],
      createdTaskIds: {},
    });
    const state = reduce(initial, action);
    expect(events(state, 'child')).toHaveSize(1);
    expect(events(state, 'sibling')).toHaveSize(1);
    expect(events(state, 'child')[0].operationId).toBe(
      events(state, 'sibling')[0].operationId,
    );
  });

  it('distinguishes complete, reopen and wont-do and does not record a repeated no-op', () => {
    let state = initial;
    for (const changes of [
      { isDone: true, doneOn: 1 },
      { isDone: false, doneOn: undefined },
      { isDone: true, doneOn: 2, wontDoOn: 2 },
      { isDone: true, doneOn: 2, wontDoOn: 2 },
    ])
      state = reduce(state, update('child', changes));
    expect(events(state, 'child').map((e) => e.after)).toEqual([
      { kind: 'status', value: 'done' },
      { kind: 'status', value: 'open' },
      { kind: 'status', value: 'wontDo' },
    ]);
  });

  it('preserves both A -> B -> A events and the author snapshots across serialized replay', () => {
    const action1 = update('child', { dueDay: '2026-11-01' });
    const first = reduce(initial, action1);
    const op1 = operation(action1);
    const action2 = update('child', { dueDay: '2026-11-02' });
    const second = reduce(first, action2);
    const op2 = operation(action2);
    const action3 = update('child', { dueDay: '2026-11-01' });
    const third = reduce(second, action3);
    const op3 = operation(action3);
    expect(
      [op1, op2, op3].every((op) => validateOperationPayload(op).success),
    ).toBeTrue();
    const replayed = reduce(
      initial,
      bulkApplyOperations({ operations: [op1, op2, op3] }),
    );
    expect(replayed.tasks.taskHistory).toEqual(third.tasks.taskHistory);
    expect(events(replayed, 'child')).toHaveSize(3);
    const duplicate = reduce(replayed, bulkApplyOperations({ operations: [op3, op3] }));
    expect(duplicate.tasks.taskHistory).toEqual(replayed.tasks.taskHistory);
  });

  it('retains recording boundary and events when loading a JSON snapshot', () => {
    const updated = reduce(initial, update('child', { deadlineDay: '2026-11-02' }));
    const defaults = Object.fromEntries(
      Object.entries(MODEL_CONFIGS).map(([key, value]) => [key, value.defaultData]),
    );
    const appDataComplete = JSON.parse(
      JSON.stringify({ ...defaults, task: updated.tasks }),
    ) as AppDataComplete;
    const loaded = reduce(initial, loadAllData({ appDataComplete }));
    expect(loaded.tasks.taskHistory).toEqual(updated.tasks.taskHistory);
    expect(loaded.tasks.taskHistory!.child.baseline!.observedAt).toBeGreaterThan(0);
    expect(loaded.tasks.taskHistory!.child.baseline!.status).toEqual({
      kind: 'status',
      value: 'open',
    });
  });

  it('retains independent parent and child histories after native deletion and snapshot reload', () => {
    const parentChanged = reduce(initial, update('parent', { dueDay: '2026-11-01' }));
    const changed = reduce(parentChanged, update('child', { deadlineDay: '2026-11-02' }));
    const deleted = reduce(
      changed,
      TaskSharedActions.deleteTask({
        task: {
          ...changed.tasks.entities.parent!,
          subTasks: [changed.tasks.entities.child!],
        },
      }),
    );
    expect(deleted.tasks.entities.parent).toBeUndefined();
    expect(deleted.tasks.entities.child).toBeUndefined();
    expect(deleted.tasks.taskHistory).toEqual(changed.tasks.taskHistory);
    const defaults = Object.fromEntries(
      Object.entries(MODEL_CONFIGS).map(([key, value]) => [key, value.defaultData]),
    );
    const appDataComplete = JSON.parse(
      JSON.stringify({ ...defaults, task: deleted.tasks }),
    ) as AppDataComplete;
    const reloaded = reduce(initial, loadAllData({ appDataComplete }));
    expect(reloaded.tasks.entities.parent).toBeUndefined();
    expect(reloaded.tasks.entities.child).toBeUndefined();
    expect(reloaded.tasks.taskHistory).toEqual(changed.tasks.taskHistory);
  });

  it('does not create past history during a legacy operation replay', () => {
    const action = update('child', { dueDay: '2026-11-01' });
    reduce(initial, action);
    const op = operation(action);
    delete (op.payload as { actionPayload: Record<string, unknown> }).actionPayload
      .taskHistory;
    const replayed = reduce(initial, bulkApplyOperations({ operations: [op] }));
    expect(events(replayed, 'child')).toEqual([]);
    expect(replayed.tasks.taskHistory!.child.baseline).toBeUndefined();
    expect(Object.values(replayed.tasks.taskHistory!.child.gaps!)).toEqual([
      {
        id: 'recording-unavailable:child',
        taskId: 'child',
        reason: 'recording-unavailable',
        detectedAt: null,
      },
    ]);
    expect(replayed.tasks.entities.child!.dueDay).toBe('2026-11-01');
    expect(
      reduce(replayed, bulkApplyOperations({ operations: [op, op] })).tasks.taskHistory,
    ).toEqual(replayed.tasks.taskHistory);
    const resumedAction = update('child', { dueDay: '2026-11-02' });
    const continued = reduce(replayed, resumedAction);
    expect(events(continued, 'child')).toHaveSize(1);
    expect(continued.tasks.taskHistory!.child.gaps).toEqual(
      replayed.tasks.taskHistory!.child.gaps,
    );
    const resumedOp = operation(resumedAction);
    expect(validateOperationPayload(resumedOp).success).toBeTrue();
    const receiver = reduce(initial, bulkApplyOperations({ operations: [resumedOp] }));
    expect(receiver.tasks.taskHistory!.child.gaps).toEqual(
      replayed.tasks.taskHistory!.child.gaps,
    );
  });

  it('does not report a user-history gap for a synthetic LWW projection', () => {
    const action = update('child', { dueDay: '2026-11-01' });
    reduce(initial, action);
    const op = operation(action);
    op.actionType = toLwwUpdateActionType('TASK');
    op.payload = {
      actionPayload: { ...initial.tasks.entities.child!, dueDay: '2026-11-01' },
      entityChanges: [],
    };
    const replayed = reduce(initial, bulkApplyOperations({ operations: [op] }));
    expect(replayed.tasks.entities.child!.dueDay).toBe('2026-11-01');
    expect(replayed.tasks.taskHistory).toBeUndefined();
  });

  it('does not report gaps for untracked fields changed by legacy clients', () => {
    const action = update('child', { title: 'Legacy title change' });
    reduce(initial, action);
    const op = operation(action);
    delete (op.payload as { actionPayload: Record<string, unknown> }).actionPayload
      .taskHistory;
    const replayed = reduce(initial, bulkApplyOperations({ operations: [op] }));
    expect(replayed.tasks.entities.child!.title).toBe('Legacy title change');
    expect(replayed.tasks.taskHistory).toBeUndefined();
  });

  it('preserves one stable operation/event identity while an action waits for sync', () => {
    setIsApplyingRemoteOps(true);
    const action = update('child', { dueDay: '2026-11-01' });
    const state = reduce(initial, action);
    const op1 = operation(action);
    const op2 = operation(action);
    expect(op1.id).toBe(op2.id);
    expect(events(state, 'child')[0].operationId).toBe(op1.id);
  });

  it('assigns distinct identities when the same action object is dispatched twice', () => {
    const action = update('child', { dueDay: '2026-11-01' });
    reduce(initial, action);
    const firstId = peekTaskHistoryCapture(action)!.operationId;
    reduce(initial, action);
    releaseTaskHistoryCapture(action);
    expect(peekTaskHistoryCapture(action)!.operationId).not.toBe(firstId);
  });

  it('rejects an inconsistent author envelope at the operation boundary', () => {
    const action = update('child', { deadlineDay: '2026-11-01' });
    reduce(initial, action);
    const op = operation(action);
    (
      op.payload as { actionPayload: { taskHistory: TaskHistoryEnvelope } }
    ).actionPayload.taskHistory.events[0].operationId = 'another-operation';
    expect(validateOperationPayload(op).success).toBeFalse();
  });

  it('projects a history delivery without reapplying losing task values or coupling to the viewer', () => {
    const actionA = update('child', { dueDay: '2026-11-01' });
    const a = reduce(initial, actionA);
    const actionB = update('child', { dueDay: '2026-11-02' });
    reduce(initial, actionB);
    const envelope = peekTaskHistoryCapture(actionB)!.envelope!;
    const merged = reduce(
      a,
      upsertPluginUserData({
        pluginUserData: {
          id: `${TASK_HISTORY_DELIVERY_PREFIX}${envelope.operationId}`,
          data: JSON.stringify(envelope),
        },
      }),
    );
    expect(merged.tasks.entities).toBe(a.tasks.entities);
    expect(merged.tasks.entities.child!.dueDay).toBe('2026-11-01');
    expect(events(merged, 'child')).toHaveSize(2);
    const afterViewerRemoval = reduce(
      merged,
      deletePluginUserData({ pluginId: 'task-history:viewer-settings' }),
    );
    expect(afterViewerRemoval.tasks.taskHistory).toEqual(merged.tasks.taskHistory);
  });

  it('merges concurrent author histories in both orders without changing their before values', () => {
    const a = reduce(initial, update('child', { dueDay: '2026-11-01' }));
    const b = reduce(initial, update('child', { dueDay: '2026-11-02' }));
    const ea = collectTaskHistory(initial.tasks, a.tasks, 'author-a', 100, 'update');
    const eb = collectTaskHistory(initial.tasks, b.tasks, 'author-b', 101, 'update');
    const ab = mergeTaskHistory(mergeTaskHistory(undefined, ea), eb);
    const ba = mergeTaskHistory(mergeTaskHistory(undefined, eb), ea);
    expect(ab).toEqual(ba);
    expect(
      Object.values(ab!.child.events).every((e) => e.before.kind === 'none'),
    ).toBeTrue();
  });
});
