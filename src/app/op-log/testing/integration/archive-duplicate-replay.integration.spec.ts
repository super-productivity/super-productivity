import { Action, ActionReducer } from '@ngrx/store';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import {
  BulkReplayReducerFailure,
  runWithBulkReplayFailureCollector,
} from '../../apply/bulk-replay-failure-collector';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { sectionSharedMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/section-shared.reducer';
import { taskSharedLifecycleMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/task-shared-lifecycle.reducer';
import {
  createMockTask,
  createStateWithExistingTasks,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { RootState } from '../../../root-store/root-state';
import {
  TASK_FEATURE_NAME,
  taskReducer,
} from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { SECTION_FEATURE_NAME } from '../../../features/section/store/section.reducer';
import { TaskWithSubTasks } from '../../../features/tasks/task.model';

/**
 * #10102: pre-fix clients could upload several copies of ONE bulk archive
 * (identical payload, different op ids and clocks). Other clients replay every
 * copy, so a second `moveToArchive` for already-archived tasks must be a no-op
 * — never a reducer failure and never extra state churn.
 */
describe('duplicate moveToArchive replay (#10102)', () => {
  const TASK_A = 'task-a';
  const TASK_B = 'task-b';
  const KEEP = 'task-keep';

  const createState = (): RootState => {
    const base = createStateWithExistingTasks(
      [TASK_A, TASK_B, KEEP],
      [],
      [TASK_A, KEEP],
      [TASK_B],
    );
    return {
      ...base,
      [SECTION_FEATURE_NAME]: {
        ids: ['section1'],
        entities: {
          section1: {
            id: 'section1',
            contextId: 'project1',
            contextType: 'PROJECT',
            title: 'Section',
            taskIds: [TASK_A, KEEP],
          },
        },
      },
    } as RootState;
  };

  const doneTask = (id: string): TaskWithSubTasks => ({
    ...createMockTask({ id, isDone: true, doneOn: 1_000 }),
    subTasks: [],
  });

  const archiveCopy = (id: string, vectorClock: Record<string, number>): Operation => ({
    id,
    actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: TASK_A,
    entityIds: [TASK_A, TASK_B],
    payload: {
      actionPayload: { tasks: [doneTask(TASK_A), doneTask(TASK_B)] },
      entityChanges: [],
    },
    clientId: 'archivingClient',
    vectorClock,
    timestamp: 5_000,
    schemaVersion: 1,
  });

  const rootReducer: ActionReducer<RootState, Action> = (state, action) => ({
    ...(state as RootState),
    [TASK_FEATURE_NAME]: taskReducer((state as RootState)[TASK_FEATURE_NAME], action),
  });
  const reducer = bulkOperationsMetaReducer(
    sectionSharedMetaReducer(taskSharedLifecycleMetaReducer(rootReducer)),
  );

  const replay = (
    state: RootState,
    operations: Operation[],
  ): { state: RootState; failures: BulkReplayReducerFailure[] } => {
    const failures: BulkReplayReducerFailure[] = [];
    const nextState = runWithBulkReplayFailureCollector(
      (failure) => failures.push(failure),
      () => reducer(state, bulkApplyOperations({ operations })),
    );
    return { state: nextState, failures };
  };

  const copy1 = archiveCopy('copy-1', { archivingClient: 2, other: 1 });
  const copy2 = archiveCopy('copy-2', { archivingClient: 2, other: 2 });

  it('archives once (sanity: the single copy removes the tasks everywhere)', () => {
    const { state, failures } = replay(createState(), [copy1]);

    expect(failures).toEqual([]);
    expect(state[TASK_FEATURE_NAME].ids).toEqual([KEEP]);
    expect(state[PROJECT_FEATURE_NAME].entities['project1']!.taskIds).toEqual([KEEP]);
    expect(state[TAG_FEATURE_NAME].entities['tag1']!.taskIds).toEqual([KEEP]);
    expect(state[SECTION_FEATURE_NAME].entities['section1']!.taskIds).toEqual([KEEP]);
  });

  it('is a no-op when the second copy arrives in the SAME batch', () => {
    const once = replay(createState(), [copy1]).state;
    const { state, failures } = replay(createState(), [copy1, copy2]);

    expect(failures).toEqual([]);
    expect(state).toEqual(once);
  });

  it('is a no-op when the second copy arrives in a LATER batch', () => {
    const once = replay(createState(), [copy1]).state;
    const { state, failures } = replay(once, [copy2]);

    expect(failures).toEqual([]);
    expect(state).toEqual(once);
  });
});
