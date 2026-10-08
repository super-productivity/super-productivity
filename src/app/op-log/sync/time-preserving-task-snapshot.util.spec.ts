import { DEFAULT_TASK } from '../../features/tasks/task.model';
import { ActionType, EntityConflict, Operation, OpType } from '../core/operation.types';
import { timeDeltasSurvivingLww } from './conflict-field-patch.util';
import { selectTaskReplacementCompensations } from './lww-compensation-selection.util';
import {
  isTimePreservingTaskSnapshot,
  preserveTaskSnapshotTimes,
  timePreservingTaskIds,
} from './time-preserving-task-snapshot.util';

const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'local',
  actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
  opType: OpType.Update,
  entityType: 'TASK',
  entityId: 'task',
  payload: { taskId: 'task', date: '2026-10-04', duration: 3000 },
  clientId: 'A',
  vectorClock: { A: 2 },
  timestamp: 20,
  schemaVersion: 1,
  ...over,
});
const plan = op({
  id: 'plan',
  actionType: ActionType.TASK_SHARED_PLAN_FOR_TODAY,
  payload: { taskIds: ['task'], today: '2026-10-04' },
});
const conflict: EntityConflict = {
  entityType: 'TASK',
  entityId: 'task',
  localOps: [plan, op()],
  remoteOps: [op({ ...plan, id: 'remote-plan', clientId: 'B', vectorClock: { B: 2 } })],
  suggestedResolution: 'manual',
};
const snapshot = op({
  id: 'snapshot',
  actionType: '[TASK] LWW Update' as ActionType,
  payload: {
    entityChanges: [],
    actionPayload: { ...DEFAULT_TASK, id: 'task', projectId: '', timeSpent: 3000 },
    lwwUpdateMode: 'replace',
  },
});
const resolution = { conflict, localWinOp: snapshot, winner: 'local' as const };

describe('source task snapshots preserve additive time', () => {
  it('changes only the existing winner payload, retaining identity, stamp and position', () => {
    const [actual] = preserveTaskSnapshotTimes([resolution], []);
    expect(actual.conflict).toBe(conflict);
    expect(actual.winner).toBe('local');
    expect({ ...actual.localWinOp, payload: snapshot.payload }).toEqual(snapshot);
    expect(actual.localWinOp.payload).toEqual({
      entityChanges: [],
      actionPayload: jasmine.objectContaining({ id: 'task', title: '', projectId: '' }),
      lwwUpdateMode: 'patch',
      clearedFields: jasmine.arrayContaining(['notes', 'dueWithTime', 'remindAt']),
    });
    const payload = actual.localWinOp.payload as { actionPayload: object };
    expect('timeSpent' in payload.actionPayload).toBeFalse();
    expect('timeSpentOnDay' in payload.actionPayload).toBeFalse();
    expect(isTimePreservingTaskSnapshot(actual.localWinOp)).toBeTrue();
  });

  it('retains per-operation winners instead of choosing an aggregate winner', () => {
    const remote = { ...resolution, winner: 'remote' as const, localWinOp: undefined };
    const actual = preserveTaskSnapshotTimes([resolution, remote], []);
    expect(actual.map(({ winner }) => winner)).toEqual(['local', 'remote']);
    expect(actual[1]).toBe(remote);
  });

  for (const blocker of [
    op({ opType: OpType.Delete }),
    op({ entityIds: ['task', 'sibling'] }),
    op({ actionType: ActionType.TASK_REMOVE_TIME_SPENT }),
    snapshot,
    op({
      actionType: ActionType.TASK_SHARED_UPDATE,
      payload: { task: { id: 'task', changes: { timeSpentOnDay: {} } } },
    }),
    op({
      actionType: '[TASK] LWW Update' as ActionType,
      payload: {
        entityChanges: [],
        actionPayload: { id: 'task' },
        lwwUpdateMode: 'patch',
        clearedFields: ['timeSpent'],
      },
    }),
  ]) {
    it(`refuses a sibling conflict or incoming ${blocker.actionType}/${blocker.opType} time boundary`, () => {
      const sibling = { ...conflict, remoteOps: [blocker] };
      expect(timePreservingTaskIds([conflict, sibling]).size).toBe(0);
      expect(preserveTaskSnapshotTimes([resolution], [blocker])[0]).toBe(resolution);
      expect(timeDeltasSurvivingLww([resolution], 'task', [blocker])).toEqual([]);
    });
  }

  it('refuses a recreation row, even when its keys contain no time', () => {
    const recreation = op({
      actionType: '[TASK] LWW Update' as ActionType,
      payload: {
        entityChanges: [],
        actionPayload: { id: 'task' },
        lwwUpdateMode: 'patch',
        recreatesEntityAfterDelete: true,
      },
    });
    expect(timePreservingTaskIds([{ ...conflict, remoteOps: [recreation] }]).size).toBe(
      0,
    );
  });

  it('preserves the local delta beside an incoming non-time source snapshot', () => {
    const [source] = preserveTaskSnapshotTimes([resolution], []);
    const remote = { ...source.localWinOp, clientId: 'B', vectorClock: { B: 3 } };
    const crossing = {
      conflict: { ...conflict, remoteOps: [remote] },
      winner: 'remote' as const,
    };
    expect(timeDeltasSurvivingLww([crossing], 'task')[0].localOps).toEqual([
      conflict.localOps[1],
    ]);
  });

  it('compensates a losing source snapshot in the same durable order as a replacement', () => {
    const [source] = preserveTaskSnapshotTimes([resolution], []);
    const remote = { ...source.localWinOp, id: 'remote-snapshot' };
    expect(
      selectTaskReplacementCompensations([
        { ...source, conflict: { ...conflict, remoteOps: [remote] } },
      ]),
    ).toEqual([{ remoteOp: remote, localWinOpId: source.localWinOp.id }]);
  });
});
