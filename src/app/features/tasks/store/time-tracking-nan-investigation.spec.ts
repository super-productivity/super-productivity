/* eslint-disable @typescript-eslint/naming-convention */
// Regression: the addTimeSpent / syncTimeSpent reducers must reject non-finite
// durations rather than letting NaN leak into task.timeSpentOnDay, where it
// would JSON-serialize to `null` on the next sync round-trip and then be
// silently zeroed by auto-fix-typia-errors (data loss).
import { Task, TaskState } from '../task.model';
import { initialTaskState, taskReducer } from './task.reducer';
import {
  TimeTrackingActions,
  syncTimeSpent,
} from '../../time-tracking/store/time-tracking.actions';
import { INBOX_PROJECT } from '../../project/project.const';
import { OpType } from '../../../op-log/core/operation.types';
import { _resetDevErrorState } from '../../../util/dev-error';

describe('addTimeSpent / syncTimeSpent — NaN guards', () => {
  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    created: Date.now(),
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    projectId: INBOX_PROJECT.id,
    parentId: undefined,
    timeSpentOnDay: {},
    timeEstimate: 0,
    timeSpent: 0,
    dueDay: undefined,
    dueWithTime: undefined,
    attachments: [],
    ...partial,
  });

  const baseState: TaskState = {
    ...initialTaskState,
    ids: ['t1'],
    entities: {
      t1: createTask('t1', { timeSpentOnDay: { '2026-05-21': 100 } }),
    },
  };

  // devError shows alert+confirm in non-prod; stub both so the guard's
  // diagnostic path doesn't block Karma. Use the defensive pattern because
  // some global test setup may already spy on these.
  beforeEach(() => {
    _resetDevErrorState();
    if (jasmine.isSpy(window.alert)) {
      (window.alert as jasmine.Spy).and.stub();
    } else {
      spyOn(window, 'alert').and.stub();
    }
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(false);
    } else {
      spyOn(window, 'confirm').and.returnValue(false);
    }
  });

  describe('addTimeSpent (local)', () => {
    it('writes a normal duration into timeSpentOnDay', () => {
      const result = taskReducer(
        baseState,
        TimeTrackingActions.addTimeSpent({
          task: baseState.entities['t1'] as Task,
          date: '2026-05-21',
          duration: 50,
          isFromTrackingReminder: false,
        }),
      );
      expect((result.entities['t1'] as Task).timeSpentOnDay['2026-05-21']).toBe(150);
    });

    it('rejects NaN duration and leaves state unchanged', () => {
      const result = taskReducer(
        baseState,
        TimeTrackingActions.addTimeSpent({
          task: baseState.entities['t1'] as Task,
          date: '2026-05-21',
          duration: NaN,
          isFromTrackingReminder: false,
        }),
      );
      expect(result).toBe(baseState);
    });

    it('rejects undefined duration and leaves state unchanged', () => {
      const result = taskReducer(
        baseState,
        TimeTrackingActions.addTimeSpent({
          task: baseState.entities['t1'] as Task,
          date: '2026-05-21',
          duration: undefined as unknown as number,
          isFromTrackingReminder: false,
        }),
      );
      expect(result).toBe(baseState);
    });

    it('rejects Infinity duration', () => {
      const result = taskReducer(
        baseState,
        TimeTrackingActions.addTimeSpent({
          task: baseState.entities['t1'] as Task,
          date: '2026-05-21',
          duration: Infinity,
          isFromTrackingReminder: false,
        }),
      );
      expect(result).toBe(baseState);
    });
  });

  describe('syncTimeSpent (remote)', () => {
    const remoteSync = (taskId: string, date: string, duration: number): any => ({
      type: syncTimeSpent.type,
      taskId,
      date,
      duration,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskId,
        opType: OpType.Update,
        isRemote: true,
      },
    });

    it('applies a normal remote duration', () => {
      const result = taskReducer(baseState, remoteSync('t1', '2026-05-21', 50));
      expect((result.entities['t1'] as Task).timeSpentOnDay['2026-05-21']).toBe(150);
    });

    it('rejects NaN remote duration and leaves state unchanged', () => {
      const result = taskReducer(baseState, remoteSync('t1', '2026-05-21', NaN));
      expect(result).toBe(baseState);
    });

    it('rejects undefined remote duration', () => {
      const result = taskReducer(
        baseState,
        remoteSync('t1', '2026-05-21', undefined as unknown as number),
      );
      expect(result).toBe(baseState);
    });
  });

  describe('JSON round-trip invariants the guards protect (documentation)', () => {
    it('JSON.stringify(NaN) becomes "null"', () => {
      expect(JSON.stringify({ x: NaN })).toBe('{"x":null}');
    });

    it('JSON.stringify(Infinity) becomes "null"', () => {
      expect(JSON.stringify({ x: Infinity })).toBe('{"x":null}');
    });
  });
});
