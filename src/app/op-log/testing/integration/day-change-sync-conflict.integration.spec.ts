/**
 * Integration test for issue #6992:
 * Proves the full conflict chain from operation creation through LWW resolution
 * to final store state.
 *
 * Tests three layers:
 * 1. Action metadata — both actions produce entityType=TASK with overlapping entityIds
 * 2. Vector clock — operations from independent clients are CONCURRENT (= true conflict)
 * 3. LWW timestamp — the operation with the newer timestamp wins
 * 4. Meta-reducer — the winning operation's effects determine final state
 */
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import {
  compareVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';
import { ActionType, EntityType, OpType, Operation } from '../../core/operation.types';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { taskSharedSchedulingMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer';
import { RootState } from '../../../root-store/root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { Action, ActionReducer } from '@ngrx/store';
import {
  createBaseState,
  createMockTask,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';

describe('Issue #6992: day-change sync conflict – full chain', () => {
  const TODAY = '2026-03-29';
  const YESTERDAY = '2026-03-28';
  const TASK_ID = 'overdue-task-1';
  const MOCK_TIME = new Date(2026, 2, 29, 12, 0, 0, 0);

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(MOCK_TIME);
    resetTestUuidCounter();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 1: Action metadata proves both actions target the same entity
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Layer 1: action metadata overlap', () => {
    it('both actions should have entityType=TASK and the same entityIds', () => {
      const planAction = TaskSharedActions.planTasksForToday({
        taskIds: [TASK_ID],
        parentTaskMap: {},
      });
      const removeAction = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: [TASK_ID],
      });

      expect(planAction.meta.entityType).toBe('TASK');
      expect(removeAction.meta.entityType).toBe('TASK');
      expect(planAction.meta.entityIds).toEqual([TASK_ID]);
      expect(removeAction.meta.entityIds).toEqual([TASK_ID]);
    });

    it('should have overlapping entityIds even in bulk operations', () => {
      const planAction = TaskSharedActions.planTasksForToday({
        taskIds: [TASK_ID],
        parentTaskMap: {},
      });
      const removeAction = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: ['other-task', TASK_ID, 'another-task'],
      });

      const planIds = new Set(planAction.meta.entityIds);
      const removeIds = new Set(removeAction.meta.entityIds);
      const overlap = [...planIds].filter((id) => removeIds.has(id));

      expect(overlap).toEqual([TASK_ID]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 2: Operations from independent clients produce CONCURRENT clocks
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Layer 2: vector clock concurrency', () => {
    it('operations from two clients with no clock exchange should be CONCURRENT', () => {
      const android = new TestClient('android-client');
      const opensuse = new TestClient('opensuse-client');

      const androidOp = android.createOperation({
        actionType: '[Task Shared] planTasksForToday' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: { taskIds: [TASK_ID] },
      });

      const opensuseOp = opensuse.createOperation({
        actionType: '[Task Shared] removeTasksFromTodayTag' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: { taskIds: [TASK_ID] },
      });

      const comparison = compareVectorClocks(
        androidOp.vectorClock,
        opensuseOp.vectorClock,
      );
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 3: LWW timestamp comparison determines the winner
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Layer 3: LWW timestamp comparison', () => {
    /**
     * Replicates the exact LWW comparison from ConflictResolutionService
     * (conflict-resolution.service.ts, lines 658-684).
     */
    const lwwWinner = (
      localOps: Operation[],
      remoteOps: Operation[],
    ): 'local' | 'remote' => {
      const localMax = Math.max(...localOps.map((op) => op.timestamp));
      const remoteMax = Math.max(...remoteOps.map((op) => op.timestamp));
      return localMax > remoteMax ? 'local' : 'remote';
    };

    it('should pick Android (remote) when its timestamp is newer (midnight scenario)', () => {
      const opensuse = new TestClient('opensuse-client');
      const android = new TestClient('android-client');

      // openSUSE created removeTasksFromTodayTag at MIDNIGHT
      const opensuseOp = opensuse.createOperation({
        actionType: '[Task Shared] removeTasksFromTodayTag' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: { taskIds: [TASK_ID] },
      });
      (opensuseOp as any).timestamp = new Date(2026, 2, 29, 0, 0, 1).getTime(); // midnight

      // Android created planTasksForToday in the MORNING
      const androidOp = android.createOperation({
        actionType: '[Task Shared] planTasksForToday' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: { taskIds: [TASK_ID] },
      });
      (androidOp as any).timestamp = new Date(2026, 2, 29, 9, 0, 0).getTime(); // 9am

      // On openSUSE: local=removeTasksFromTodayTag, remote=planTasksForToday
      const winner = lwwWinner([opensuseOp], [androidOp]);
      expect(winner).toBe('remote'); // Android wins → correct resolution
    });

    it('should pick openSUSE (local) when its timestamp is newer (delayed day-change — THE BUG)', () => {
      const opensuse = new TestClient('opensuse-client');
      const android = new TestClient('android-client');

      // Android created planTasksForToday at 9am
      const androidOp = android.createOperation({
        actionType: '[Task Shared] planTasksForToday' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: { taskIds: [TASK_ID] },
      });
      (androidOp as any).timestamp = new Date(2026, 2, 29, 9, 0, 0).getTime(); // 9am

      // openSUSE created removeTasksFromTodayTag at 9:30am (delayed day-change,
      // after user switched to openSUSE from Android)
      const opensuseOp = opensuse.createOperation({
        actionType: '[Task Shared] removeTasksFromTodayTag' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: { taskIds: [TASK_ID] },
      });
      (opensuseOp as any).timestamp = new Date(2026, 2, 29, 9, 30, 0).getTime(); // 9:30am

      // On openSUSE: local=removeTasksFromTodayTag, remote=planTasksForToday
      const winner = lwwWinner([opensuseOp], [androidOp]);
      expect(winner).toBe('local'); // openSUSE wins → BUG: Android's op rejected
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYER 4: End-to-end — winning side's effects determine final state
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Layer 4: final store state after resolution', () => {
    let metaReducer: ActionReducer<any, Action>;

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
        [appStateFeatureKey]: { todayStr: TODAY, startOfNextDayDiffMs: 0 },
      } as Partial<RootState> as RootState;
    };

    beforeEach(() => {
      const passthrough: ActionReducer<any, Action> = (state) => state;
      metaReducer = taskSharedSchedulingMetaReducer(passthrough);
    });

    it('midnight scenario: Android wins LWW → state converges correctly', () => {
      const initial = createInitialState();

      // 1. openSUSE applies removeTasksFromTodayTag locally (midnight)
      const removeAction = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: [TASK_ID],
      });
      const afterRemove = metaReducer(initial, removeAction) as RootState;

      // 2. Sync: Android's planTasksForToday wins LWW (newer timestamp) → applied
      const planAction = TaskSharedActions.planTasksForToday({
        taskIds: [TASK_ID],
        parentTaskMap: {},
      });
      const finalState = metaReducer(afterRemove, planAction) as RootState;

      // ✓ Task is in TODAY_TAG with correct dueDay
      const todayTaskIds = (finalState[TAG_FEATURE_NAME].entities['TODAY'] as Tag)
        .taskIds;
      const task = finalState[TASK_FEATURE_NAME].entities[TASK_ID] as Task;
      expect(todayTaskIds).toContain(TASK_ID);
      expect(task.dueDay).toBe(TODAY);
    });

    it('delayed day-change scenario: openSUSE wins LWW → task remains overdue (BUG)', () => {
      const initial = createInitialState();

      // 1. openSUSE applies removeTasksFromTodayTag locally (9:30am — delayed)
      const removeAction = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: [TASK_ID],
      });
      const afterRemove = metaReducer(initial, removeAction) as RootState;

      // 2. Sync: openSUSE's removeTasksFromTodayTag wins LWW (newer timestamp)
      //    → Android's planTasksForToday is REJECTED (never dispatched)
      //    → Final state = afterRemove

      // ✗ BUG: task is NOT in TODAY_TAG and still has yesterday's dueDay
      const todayTaskIds = (afterRemove[TAG_FEATURE_NAME].entities['TODAY'] as Tag)
        .taskIds;
      const task = afterRemove[TASK_FEATURE_NAME].entities[TASK_ID] as Task;
      expect(todayTaskIds).not.toContain(TASK_ID);
      expect(task.dueDay).toBe(YESTERDAY); // ← This is the user-visible bug
    });
  });
});
