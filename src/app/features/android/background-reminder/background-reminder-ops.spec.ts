import { Action } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import {
  ActionType,
  EntityConflict,
  Operation,
  OpType,
} from '../../../op-log/core/operation.types';
import { createLWWUpdateOp } from '../../../op-log/sync/lww-update-op.util';
import { preserveTaskSnapshotTimes } from '../../../op-log/sync/time-preserving-task-snapshot.util';
import fixtureJson from '../../../../../android/app/src/test/resources/background-reminder-ops.json';

/**
 * Pins the shared fixture the Android background reminder parser is tested
 * against (SuperSyncBackgroundProvider.kt, BackgroundReminderOpFixturesTest.kt)
 * to the ops this app really produces. If an action's payload shape changes,
 * this spec fails here instead of reminders silently no longer reaching a
 * closed phone. Regenerate an entry from `buildOps()` and re-check the Kotlin
 * parser when it does.
 */

// Year 2100: always in the future for the Kotlin parser's `remindAt > now`
type Fixture = { name: string; op: unknown };
const fixtures = fixtureJson as unknown as Fixture[];

const DUE = 4102444800000;
const REMIND_AT = 4102444200000;
const DEADLINE_REMIND_AT = 4102444500000;

const task = (over: Partial<Task>): Task => ({
  ...DEFAULT_TASK,
  projectId: 'INBOX_PROJECT',
  created: 1755700000000,
  ...over,
});

type WireOp = Pick<
  Operation,
  'actionType' | 'opType' | 'entityType' | 'entityId' | 'entityIds' | 'payload'
>;

// What OperationLogEffects stores and uploads: the action minus type/meta,
// wrapped in a MultiEntityPayload (entityChanges is [] for task actions).
const fromAction = (action: Action & { meta: PersistentActionMeta }): WireOp => {
  const { type, meta, ...actionPayload } = action;
  return {
    actionType: type as ActionType,
    opType: meta.opType,
    entityType: meta.entityType,
    entityId: meta.entityId ?? meta.entityIds?.[0],
    ...(meta.entityIds && { entityIds: meta.entityIds }),
    payload: { actionPayload, entityChanges: [] },
  };
};

const fromOp = ({
  actionType,
  opType,
  entityType,
  entityId,
  entityIds,
  payload,
}: Operation): WireOp => ({
  actionType,
  opType,
  entityType,
  entityId,
  ...(entityIds && { entityIds }),
  payload,
});

const lwwReplace = (entity: Task): Operation =>
  createLWWUpdateOp('TASK', entity.id, entity, 'B', { B: 1 }, 1755700000000, 'replace');

const buildOps = (): Record<string, WireOp> => {
  const timedTask = task({ id: 'task-lww-tp', title: 'Tracked', timeSpent: 3000 });
  const syncTime = (id: string, clientId: string): Operation => ({
    id,
    actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: timedTask.id,
    payload: { taskId: timedTask.id, date: '2026-10-04', duration: 3000 },
    clientId,
    vectorClock: { [clientId]: 2 },
    timestamp: 20,
    schemaVersion: 1,
  });
  const conflict: EntityConflict = {
    entityType: 'TASK',
    entityId: timedTask.id,
    localOps: [syncTime('local', 'A')],
    remoteOps: [syncTime('remote', 'B')],
    suggestedResolution: 'manual',
  };
  const [timePreserving] = preserveTaskSnapshotTimes(
    [
      {
        conflict,
        winner: 'local' as const,
        localWinOp: lwwReplace({ ...timedTask, dueWithTime: DUE, remindAt: REMIND_AT }),
      },
    ],
    [],
  );

  return {
    scheduleTaskWithTime: fromAction(
      TaskSharedActions.scheduleTaskWithTime({
        task: task({ id: 'task-sched', title: 'Buy milk' }),
        dueWithTime: DUE,
        remindAt: REMIND_AT,
        isMoveToBacklog: false,
      }),
    ),
    // Mirrors ShortSyntaxEffects for "Call mom @15:00"
    shortSyntaxWithTime: fromAction(
      TaskSharedActions.applyShortSyntax({
        task: task({ id: 'task-ss-time', title: 'Call mom @15:00' }),
        taskChanges: { title: 'Call mom', dueWithTime: DUE },
        schedulingInfo: { dueWithTime: DUE, remindAt: REMIND_AT, isMoveToBacklog: false },
      }),
    ),
    // Mirrors ShortSyntaxEffects for "Call mom @tomorrow" (day only)
    shortSyntaxDayOnly: fromAction(
      TaskSharedActions.applyShortSyntax({
        task: task({ id: 'task-ss-day', title: 'Call mom @tomorrow' }),
        taskChanges: { title: 'Call mom' },
        schedulingInfo: { day: '2100-01-01', isAddToTop: false },
      }),
    ),
    updateTaskReminder: fromAction(
      TaskSharedActions.updateTask({
        task: {
          id: 'task-upd',
          changes: { remindAt: REMIND_AT, deadlineRemindAt: DEADLINE_REMIND_AT },
        },
      }),
    ),
    updateTaskDone: fromAction(
      TaskSharedActions.updateTask({
        task: { id: 'task-done', changes: { isDone: true } },
      }),
    ),
    updateTasksBulkDone: fromAction(
      TaskSharedActions.updateTasks({
        tasks: [
          { id: 'task-bulk-1', changes: { isDone: true } },
          { id: 'task-bulk-2', changes: { isDone: true } },
        ],
      }),
    ),
    addTaskWithReminder: fromAction(
      TaskSharedActions.addTask({
        task: task({
          id: 'task-add',
          title: 'Dentist',
          dueWithTime: DUE,
          remindAt: REMIND_AT,
        }),
        workContextId: 'INBOX_PROJECT',
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: false,
      }),
    ),
    lwwReplaceWithReminder: fromOp(
      lwwReplace(
        task({ id: 'task-lww', title: 'Winner', dueWithTime: DUE, remindAt: REMIND_AT }),
      ),
    ),
    lwwReplaceWithoutReminder: fromOp(
      lwwReplace(task({ id: 'task-lww-none', title: 'No reminder' })),
    ),
    // Time-preserving conflict winner: a patch whose clearedFields lists the
    // absent deadlineRemindAt while it still sets remindAt
    lwwTimePreservingPatch: fromOp(timePreserving.localWinOp!),
  };
};

describe('Android background reminder op fixtures', () => {
  it('matches the ops the app produces', () => {
    const built = JSON.parse(JSON.stringify(buildOps())) as Record<string, WireOp>;
    const fixtureOps = Object.fromEntries(fixtures.map((f) => [f.name, f.op]));
    expect(Object.keys(fixtureOps).sort()).toEqual(Object.keys(built).sort());
    for (const name of Object.keys(built)) {
      expect(fixtureOps[name]).withContext(name).toEqual(built[name]);
    }
  });

  it('time-preserving fixture really is a patch clearing deadlineRemindAt', () => {
    const op = buildOps().lwwTimePreservingPatch.payload as {
      lwwUpdateMode: string;
      clearedFields: string[];
    };
    expect(op.lwwUpdateMode).toBe('patch');
    expect(op.clearedFields).toContain('deadlineRemindAt');
  });
});
