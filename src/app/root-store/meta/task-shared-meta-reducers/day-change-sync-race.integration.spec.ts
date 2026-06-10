/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Integration test for issue #6992:
 * Sync differences between devices after new-day routines.
 *
 * Scenario:
 * - Device A (Android): user moves an overdue task (dueDay=yesterday) to today
 *   → dispatches planTasksForToday → creates op with entityType=TASK
 * - Device B (openSUSE): day-change effect removes overdue tasks from TODAY_TAG
 *   → dispatches removeTasksFromTodayTag → creates op with entityType=TASK
 *
 * Race condition:
 * When Device B's day-change fires AFTER the user acts on Device A (delayed
 * todayDateStr$ emission), Device B's removeTasksFromTodayTag has a NEWER
 * timestamp. LWW picks Device B → Device A's planTasksForToday is rejected →
 * the task remains overdue on Device B, while Device A shows it in today.
 *
 * This test proves:
 * 1. When planTasksForToday IS applied after removeTasksFromTodayTag (Android wins LWW),
 *    the state converges correctly (task in TODAY_TAG with dueDay=today).
 * 2. When planTasksForToday is NOT applied (openSUSE wins LWW), the task
 *    remains overdue — confirming the bug.
 */
import { taskSharedSchedulingMetaReducer } from './task-shared-scheduling.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { Action, ActionReducer } from '@ngrx/store';
import { createBaseState, createMockTask } from './test-utils';
import { appStateFeatureKey } from '../../app-state/app-state.reducer';

describe('Issue #6992: day-change + sync race condition', () => {
  let metaReducer: ActionReducer<any, Action>;

  const TODAY = '2026-03-29';
  const YESTERDAY = '2026-03-28';
  const TASK_ID = 'overdue-task-1';

  // Fixed time at noon to avoid midnight boundary issues
  const MOCK_TIME = new Date(2026, 2, 29, 12, 0, 0, 0);

  /**
   * Build a state that mirrors the start-of-day condition on both devices:
   * - Task exists with dueDay = yesterday
   * - Task is in TODAY_TAG.taskIds (it was there since yesterday)
   */
  const createInitialState = (): RootState => {
    const base = createBaseState();
    const task = createMockTask({
      id: TASK_ID,
      title: 'Overdue task',
      dueDay: YESTERDAY,
      tagIds: [],
      projectId: undefined,
    });

    return {
      ...base,
      [TASK_FEATURE_NAME]: {
        ...base[TASK_FEATURE_NAME],
        ids: [TASK_ID],
        entities: { [TASK_ID]: task },
      },
      [TAG_FEATURE_NAME]: {
        ...base[TAG_FEATURE_NAME],
        entities: {
          ...base[TAG_FEATURE_NAME].entities,
          TODAY: {
            ...base[TAG_FEATURE_NAME].entities['TODAY'],
            taskIds: [TASK_ID],
          } as Tag,
        },
      },
      [appStateFeatureKey]: {
        todayStr: TODAY,
        startOfNextDayDiffMs: 0,
      },
    } as Partial<RootState> as RootState;
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(MOCK_TIME);
    // Passthrough reducer: returns whatever state the meta-reducer built
    const passthrough: ActionReducer<any, Action> = (state) => state;
    metaReducer = taskSharedSchedulingMetaReducer(passthrough);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  // ---------------------------------------------------------------------------
  // Helper: read the task & tag back from a RootState
  // ---------------------------------------------------------------------------
  const readTask = (s: RootState): Task => s[TASK_FEATURE_NAME].entities[TASK_ID] as Task;
  const readTodayTaskIds = (s: RootState): string[] =>
    (s[TAG_FEATURE_NAME].entities['TODAY'] as Tag).taskIds;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  // The FIX: automated overdue removal now uses non-persistent action (#6992)
  const removeOverdueAction = TaskSharedActions.localRemoveOverdueFromToday({
    taskIds: [TASK_ID],
  });

  // User-initiated removal (still persistent, for comparison)
  const removeOverduePersistentAction = TaskSharedActions.removeTasksFromTodayTag({
    taskIds: [TASK_ID],
  });

  const planForTodayAction = TaskSharedActions.planTasksForToday({
    taskIds: [TASK_ID],
    parentTaskMap: {},
  });

  // =========================================================================
  // FIX VERIFICATION: localRemoveOverdueFromToday is NOT persistent
  // =========================================================================
  describe('Fix: localRemoveOverdueFromToday is non-persistent', () => {
    it('should NOT have isPersistent meta (no sync operation created)', () => {
      const action = TaskSharedActions.localRemoveOverdueFromToday({
        taskIds: [TASK_ID],
      });
      expect((action as any).meta?.isPersistent).toBeFalsy();
    });

    it('persistent removeTasksFromTodayTag should still have isPersistent', () => {
      const action = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: [TASK_ID],
      });
      expect(action.meta.isPersistent).toBe(true);
    });

    it('both actions should produce the same state change', () => {
      const initial = createInitialState();

      const afterLocal = metaReducer(initial, removeOverdueAction) as RootState;
      const afterPersistent = metaReducer(
        initial,
        removeOverduePersistentAction,
      ) as RootState;

      expect(readTodayTaskIds(afterLocal)).toEqual(readTodayTaskIds(afterPersistent));
      expect(readTask(afterLocal).dueDay).toBe(readTask(afterPersistent).dueDay);
    });
  });

  // =========================================================================
  // CASE A — Android wins LWW (expected correct flow)
  //
  // Device B applied removeTasksFromTodayTag locally (midnight).
  // Then sync delivers Android's planTasksForToday (morning, newer timestamp).
  // Because Android wins, planTasksForToday IS applied on top of current state.
  // =========================================================================
  describe('Case A: planTasksForToday applied AFTER removeTasksFromTodayTag (Android wins LWW)', () => {
    it('should restore the task to TODAY_TAG and update dueDay to today', () => {
      const initial = createInitialState();

      // Step 1 — Device B's day-change effect (midnight)
      const afterRemove = metaReducer(initial, removeOverdueAction) as RootState;

      // Task should be removed from TODAY_TAG, dueDay unchanged
      expect(readTodayTaskIds(afterRemove)).not.toContain(TASK_ID);
      expect(readTask(afterRemove).dueDay).toBe(YESTERDAY);

      // Step 2 — Sync applies Android's planTasksForToday (morning, won LWW)
      const afterPlan = metaReducer(afterRemove, planForTodayAction) as RootState;

      // Task should be back in TODAY_TAG with dueDay = today
      expect(readTodayTaskIds(afterPlan)).toContain(TASK_ID);
      expect(readTask(afterPlan).dueDay).toBe(TODAY);
    });
  });

  // =========================================================================
  // CASE B — openSUSE wins LWW (the bug scenario)
  //
  // Device B's removeTasksFromTodayTag has a NEWER timestamp because the
  // day-change emission was delayed (backgroundThrottling, OS sleep, etc.)
  // and fired only when the user focused the window — AFTER Android's action.
  //
  // LWW picks Device B → planTasksForToday is REJECTED (never applied).
  // =========================================================================
  describe('Case B: planTasksForToday REJECTED — removeTasksFromTodayTag wins LWW (the bug)', () => {
    it('should leave the task overdue when planTasksForToday is not applied', () => {
      const initial = createInitialState();

      // Device B's day-change effect runs (with NEWER timestamp — wins LWW)
      const afterRemove = metaReducer(initial, removeOverdueAction) as RootState;

      // planTasksForToday from Android is REJECTED (not applied).
      // Final state === afterRemove.

      // BUG: task is NOT in TODAY_TAG and still has yesterday's dueDay
      expect(readTodayTaskIds(afterRemove)).not.toContain(TASK_ID);
      expect(readTask(afterRemove).dueDay).toBe(YESTERDAY);
    });
  });

  // =========================================================================
  // CASE C — No conflict (Planner path: entityType mismatch)
  //
  // If the user moved the task via planner drag-drop, the operation has
  // entityType=PLANNER (not TASK). No conflict is detected with
  // removeTasksFromTodayTag (entityType=TASK). Both operations are applied.
  //
  // The transferTask meta-reducer updates dueDay AND TODAY_TAG, so even
  // without conflict detection, the state should converge.
  //
  // NOTE: We simulate this by applying both actions sequentially. The
  // planner meta-reducer is separate, but the net effect is the same:
  // both removeTasksFromTodayTag and the dueDay + TODAY_TAG update are applied.
  // =========================================================================
  describe('Case C: both operations applied independently (no conflict, Planner path)', () => {
    it('should produce correct state when planTasksForToday is applied after removal', () => {
      const initial = createInitialState();

      // Step 1 — removeTasksFromTodayTag (entityType=TASK, local)
      const afterRemove = metaReducer(initial, removeOverdueAction) as RootState;

      // Step 2 — planTasksForToday (simulating the dueDay + TODAY_TAG update
      //          from the planner meta-reducer, entityType=PLANNER)
      const afterPlan = metaReducer(afterRemove, planForTodayAction) as RootState;

      // Even without conflict detection, planTasksForToday correctly
      // re-adds the task and updates dueDay because the meta-reducer
      // checks current state.
      expect(readTodayTaskIds(afterPlan)).toContain(TASK_ID);
      expect(readTask(afterPlan).dueDay).toBe(TODAY);
    });

    it('should leave task NOT in TODAY_TAG when removal is applied AFTER plan (reverse order)', () => {
      const initial = createInitialState();

      // Step 1 — planTasksForToday first
      const afterPlan = metaReducer(initial, planForTodayAction) as RootState;
      expect(readTodayTaskIds(afterPlan)).toContain(TASK_ID);
      expect(readTask(afterPlan).dueDay).toBe(TODAY);

      // Step 2 — removeTasksFromTodayTag second (removes from TODAY_TAG only)
      const afterRemove = metaReducer(afterPlan, removeOverdueAction) as RootState;

      // dueDay WAS updated by planTasksForToday, but the task is no longer
      // in TODAY_TAG. The overdue selector checks dueDay, so the task would
      // NOT show as overdue (dueDay = today). But it also wouldn't appear
      // in the today list (not in TODAY_TAG.taskIds).
      expect(readTodayTaskIds(afterRemove)).not.toContain(TASK_ID);
      expect(readTask(afterRemove).dueDay).toBe(TODAY);
    });
  });

  // =========================================================================
  // CASE D — Multiple overdue tasks, only one moved to today
  //
  // removeTasksFromTodayTag passes ALL overdue task IDs as a bulk op.
  // planTasksForToday passes only the ONE task the user moved.
  // Both have entityType=TASK but the conflict detection iterates entityIds,
  // so it correctly identifies the overlapping task.
  // =========================================================================
  describe('Case D: bulk removal with single task plan', () => {
    it('should handle partial overlap between bulk remove and single plan', () => {
      const base = createBaseState();
      const taskA = createMockTask({
        id: 'task-A',
        title: 'Overdue A',
        dueDay: YESTERDAY,
        tagIds: [],
        projectId: undefined,
      });
      const taskB = createMockTask({
        id: 'task-B',
        title: 'Overdue B',
        dueDay: YESTERDAY,
        tagIds: [],
        projectId: undefined,
      });
      const state: RootState = {
        ...base,
        [TASK_FEATURE_NAME]: {
          ...base[TASK_FEATURE_NAME],
          ids: ['task-A', 'task-B'],
          entities: { 'task-A': taskA, 'task-B': taskB },
        },
        [TAG_FEATURE_NAME]: {
          ...base[TAG_FEATURE_NAME],
          entities: {
            ...base[TAG_FEATURE_NAME].entities,
            TODAY: {
              ...base[TAG_FEATURE_NAME].entities['TODAY'],
              taskIds: ['task-A', 'task-B'],
            } as Tag,
          },
        },
        [appStateFeatureKey]: { todayStr: TODAY, startOfNextDayDiffMs: 0 },
      } as Partial<RootState> as RootState;

      // Bulk removal of all overdue tasks (non-persistent, as the fix does)
      const bulkRemove = TaskSharedActions.localRemoveOverdueFromToday({
        taskIds: ['task-A', 'task-B'],
      });
      const afterRemove = metaReducer(state, bulkRemove) as RootState;
      expect(readTodayTaskIds(afterRemove)).toEqual([]);

      // User only moved task-B to today
      const planB = TaskSharedActions.planTasksForToday({
        taskIds: ['task-B'],
        parentTaskMap: {},
      });
      const afterPlan = metaReducer(afterRemove, planB) as RootState;

      // task-B should be in TODAY with updated dueDay
      expect(readTodayTaskIds(afterPlan)).toContain('task-B');
      expect((afterPlan[TASK_FEATURE_NAME].entities['task-B'] as Task).dueDay).toBe(
        TODAY,
      );

      // task-A should still be absent from TODAY and still overdue
      expect(readTodayTaskIds(afterPlan)).not.toContain('task-A');
      expect((afterPlan[TASK_FEATURE_NAME].entities['task-A'] as Task).dueDay).toBe(
        YESTERDAY,
      );
    });
  });
});
