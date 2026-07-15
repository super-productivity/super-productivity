/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Integration test for #9025.
 *
 * A single user intent — updateTask with an invalid `projectId` — must reach
 * the SAME state whether a receiving client replays it normally
 * (handleUpdateTask, which strips the invalid projectId) or applies it as a
 * resolved LWW conflict (lwwUpdateMetaReducer's patch path). The bug was that
 * the LWW path orphaned the task on an explicit `null` while the normal path
 * kept it — permanent cross-client divergence.
 *
 * These tests compose the three meta-reducers that actually touch a task's
 * project membership, in registry order (section -> crud -> lww), and assert
 * that the normal-replay path and the LWW-patch path converge on the same
 * task.projectId, project.taskIds and section membership. The same composed
 * chain routes each action type to the correct handler: a plain updateTask is
 * a no-op for lww, and a `[TASK] LWW Update` is a no-op for crud.
 */
import { Action, ActionReducer } from '@ngrx/store';
import { sectionSharedMetaReducer } from './section-shared.reducer';
import { taskSharedCrudMetaReducer } from './task-shared-crud.reducer';
import { lwwUpdateMetaReducer } from './lww-update.meta-reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { SECTION_FEATURE_NAME } from '../../../features/section/store/section.reducer';
import { appStateFeatureKey } from '../../app-state/app-state.reducer';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { Task } from '../../../features/tasks/task.model';
import { Project } from '../../../features/project/project.model';
import { createMockTask, createMockProject } from './test-utils';

describe('#9025: LWW vs normal-replay projectId convergence', () => {
  const TASK_ID = 'task-1';
  const PROJECT_ID = 'proj-a';
  const SECTION_ID = 'sec-a';

  const identity: ActionReducer<any, Action> = (s) => s;
  // Registry order: section (outer) -> crud -> lww (inner). The same chain
  // handles both action types; each is a no-op for the reducer that doesn't own it.
  const chain = sectionSharedMetaReducer(
    taskSharedCrudMetaReducer(lwwUpdateMetaReducer(identity)),
  );

  const createState = (): RootState =>
    ({
      [TASK_FEATURE_NAME]: {
        ids: [TASK_ID],
        entities: {
          [TASK_ID]: createMockTask({ id: TASK_ID, projectId: PROJECT_ID }),
        },
        currentTaskId: null,
        selectedTaskId: null,
        taskDetailTargetPanel: null,
        isDataLoaded: true,
        lastCurrentTaskId: null,
      },
      [PROJECT_FEATURE_NAME]: {
        ids: [PROJECT_ID],
        entities: {
          [PROJECT_ID]: createMockProject({ id: PROJECT_ID, taskIds: [TASK_ID] }),
        },
      },
      [TAG_FEATURE_NAME]: { ids: [], entities: {} },
      [SECTION_FEATURE_NAME]: {
        ids: [SECTION_ID],
        entities: {
          [SECTION_ID]: {
            id: SECTION_ID,
            contextId: PROJECT_ID,
            contextType: WorkContextType.PROJECT,
            title: 'Section A',
            taskIds: [TASK_ID],
          },
        },
      },
      [appStateFeatureKey]: { todayStr: getDbDateStr(), startOfNextDayDiffMs: 0 },
    }) as unknown as RootState;

  const membership = (
    state: RootState,
  ): { projectId: unknown; projectTaskIds: string[]; sectionTaskIds: string[] } => ({
    projectId: (state[TASK_FEATURE_NAME].entities[TASK_ID] as Task).projectId,
    projectTaskIds: (state[PROJECT_FEATURE_NAME].entities[PROJECT_ID] as Project).taskIds,
    sectionTaskIds: state[SECTION_FEATURE_NAME].entities[SECTION_ID]!.taskIds,
  });

  const replayNormally = (projectId: string | null): RootState =>
    chain(createState(), {
      ...TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes: { projectId } as Partial<Task> },
      }),
    }) as RootState;

  const applyAsLwwPatch = (projectId: string | null): RootState =>
    chain(createState(), {
      type: '[TASK] LWW Update',
      id: TASK_ID,
      projectId,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: TASK_ID,
        lwwUpdateMode: 'patch',
      },
    } as unknown as Action) as RootState;

  for (const invalid of [
    { label: 'explicit null', value: null },
    { label: 'unknown project id', value: 'ghost-project' },
  ]) {
    it(`converges for an ${invalid.label} destination`, () => {
      const normal = membership(replayNormally(invalid.value));
      const lww = membership(applyAsLwwPatch(invalid.value));

      // Both paths keep the task in its original project and section...
      expect(normal.projectId).toBe(PROJECT_ID);
      expect(normal.projectTaskIds).toEqual([TASK_ID]);
      expect(normal.sectionTaskIds).toEqual([TASK_ID]);
      // ...and the LWW path matches the normal path exactly (no divergence).
      expect(lww).toEqual(normal);
    });
  }

  it('still moves the task when the LWW destination is a real project', () => {
    // Guards against the fix over-stripping: a valid move must still apply.
    const state = createState();
    (state[PROJECT_FEATURE_NAME].entities as Record<string, Project>)['proj-b'] =
      createMockProject({ id: 'proj-b', taskIds: [] });
    (state[PROJECT_FEATURE_NAME].ids as string[]).push('proj-b');

    const next = chain(state, {
      type: '[TASK] LWW Update',
      id: TASK_ID,
      projectId: 'proj-b',
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: TASK_ID,
        lwwUpdateMode: 'patch',
      },
    } as unknown as Action) as RootState;

    expect((next[TASK_FEATURE_NAME].entities[TASK_ID] as Task).projectId).toBe('proj-b');
    expect((next[PROJECT_FEATURE_NAME].entities[PROJECT_ID] as Project).taskIds).toEqual(
      [],
    );
    expect((next[PROJECT_FEATURE_NAME].entities['proj-b'] as Project).taskIds).toEqual([
      TASK_ID,
    ]);
  });
});
