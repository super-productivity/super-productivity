/**
 * Diagnostic harness for issue #7330 — "Sync conflict error on Windows after
 * hibernate". The goal is NOT to prove a preformed theory but to surface WHICH
 * cross-model invariant fires for each plausible post-hibernate state shape,
 * so the fix can target the actual bug instead of a guessed one.
 *
 * Each scenario constructs an AppDataComplete-shaped snapshot that represents
 * what NgRx state could look like after a resume-triggered sync applies remote
 * ops to a locally-held store. We then run `isRelatedModelDataValid` against it
 * and read the error message — the same path that eventually emits the
 * "data was automatically corrected" alert via RepairOperationService.
 *
 * We bypass Typia here intentionally: the reporter's state almost certainly
 * passes schema validation (the alert only fires after the Typia-valid state
 * reaches cross-model checks). Calling `isRelatedModelDataValid` directly keeps
 * the focus on relationship invariants.
 */

import { AppDataComplete } from '../model/model-config';
import {
  getLastValidityError,
  isRelatedModelDataValid,
} from './is-related-model-data-valid';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { plannerInitialState } from '../../features/planner/store/planner.reducer';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { initialMetricState } from '../../features/metric/store/metric.reducer';
import { menuTreeInitialState } from '../../features/menu-tree/store/menu-tree.reducer';
import { DEFAULT_TASK, Task } from '../../features/tasks/task.model';
import { DEFAULT_PROJECT } from '../../features/project/project.const';
import { DEFAULT_TAG } from '../../features/tag/tag.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';
import { environment } from '../../../environments/environment';

// `devError` on the unhappy path calls native `confirm()`/`alert()` in dev mode.
// Force production mode so we don't pop a dialog inside Karma.
const withProductionMode = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  const original = environment.production;
  (environment as { production: boolean }).production = true;
  try {
    return await fn();
  } finally {
    (environment as { production: boolean }).production = original;
  }
};

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    ...DEFAULT_TASK,
    id: 'task-1',
    title: 'T',
    projectId: 'project-1',
    tagIds: ['tag-1'],
    ...overrides,
  }) as Task;

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  ...DEFAULT_PROJECT,
  id: 'project-1',
  title: 'P',
  taskIds: [],
  backlogTaskIds: [],
  noteIds: [],
  ...overrides,
});

const makeTag = (overrides: Partial<Tag> = {}): Tag => ({
  ...DEFAULT_TAG,
  id: 'tag-1',
  title: 'Tag',
  taskIds: [],
  ...overrides,
});

/**
 * Returns an AppDataComplete skeleton with one valid project, one valid tag,
 * the TODAY_TAG, and no tasks. Individual scenarios mutate specific slices to
 * inject the corruption they want to reproduce.
 */
const makeBaseState = (): AppDataComplete => {
  const project = makeProject({ taskIds: [], backlogTaskIds: [] });
  const tag = makeTag({ taskIds: [] });
  const today: Tag = { ...TODAY_TAG, taskIds: [] };
  return {
    task: {
      ids: [],
      entities: {},
      currentTaskId: null,
      selectedTaskId: null,
      taskDetailTargetPanel: null,
      lastCurrentTaskId: null,
      isDataLoaded: true,
    },
    project: {
      ids: [project.id],
      entities: { [project.id]: project },
    },
    tag: {
      ids: [tag.id, TODAY_TAG.id],
      entities: { [tag.id]: tag, [TODAY_TAG.id]: today },
    },
    taskRepeatCfg: { ids: [], entities: {} },
    note: { ids: [], entities: {}, todayOrder: [] },
    simpleCounter: { ids: [], entities: {} },
    issueProvider: { ids: [], entities: {} },
    metric: initialMetricState,
    boards: { boardCfgs: [] },
    planner: plannerInitialState,
    menuTree: menuTreeInitialState,
    globalConfig: DEFAULT_GLOBAL_CONFIG,
    timeTracking: initialTimeTrackingState,
    reminders: [],
    pluginUserData: [],
    pluginMetadata: [],
    archiveYoung: {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
    archiveOld: {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
  } as unknown as AppDataComplete;
};

describe('Hibernate repro — cross-model invariants (issue #7330)', () => {
  /**
   * S1: a remote DELETE_TASK arrived but project.taskIds still references the
   * vanished task. This is what happens if the project-shared meta-reducer
   * doesn't strip the id during a remote bulk-apply.
   */
  it('S1 — project.taskIds references a deleted task', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      (state.project.entities['project-1'] as { taskIds: string[] }).taskIds = [
        'ghost-task',
      ];

      const isValid = isRelatedModelDataValid(state);
      const err = getLastValidityError();

      console.log('[S1]', { isValid, err });
      expect(isValid).toBe(false);
      expect(err).toContain('Missing task data');
    });
  });

  /**
   * S2: a task survived a remote DELETE_TAG with a stale tagId still in
   * task.tagIds.
   */
  it('S2 — task.tagIds references a deleted tag', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      const task = makeTask({ id: 'task-2', tagIds: ['ghost-tag'] });
      state.task.ids = [task.id];
      state.task.entities = { [task.id]: task };
      (state.project.entities['project-1'] as { taskIds: string[] }).taskIds = [task.id];

      const isValid = isRelatedModelDataValid(state);
      const err = getLastValidityError();

      console.log('[S2]', { isValid, err });
      expect(isValid).toBe(false);
      expect(err).toContain('tagId from task not existing');
    });
  });

  /**
   * S3: a task survived a remote DELETE_PROJECT with a stale projectId. This
   * is the strongest candidate for the real-world alert because project
   * deletes have a large meta-reducer fan-out and a single missed branch
   * leaves dangling refs.
   */
  it('S3 — task.projectId references a deleted project', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      const task = makeTask({
        id: 'task-3',
        projectId: 'ghost-project',
        tagIds: ['tag-1'],
      });
      state.task.ids = [task.id];
      state.task.entities = { [task.id]: task };
      (state.tag.entities['tag-1'] as { taskIds: string[] }).taskIds = [task.id];
      // Pretend the remote delete already pruned the project entity, but
      // left the task untouched.
      state.project.ids = [];
      state.project.entities = {};

      const isValid = isRelatedModelDataValid(state);
      const err = getLastValidityError();

      console.log('[S3]', { isValid, err });
      expect(isValid).toBe(false);
      expect(err).toContain('projectId from task not existing');
    });
  });

  /**
   * S4: task.ids contains an id whose entity is missing. This is what a
   * partially-applied bulkApplyOperations would look like if one DELETE_TASK
   * action updated the ids slice but a subsequent reducer early-returned.
   */
  it('S4 — task.ids has an orphan with no matching entity', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      state.task.ids = ['orphan-id'];
      state.task.entities = {};

      const isValid = isRelatedModelDataValid(state);
      const err = getLastValidityError();

      console.log('[S4]', { isValid, err });
      expect(isValid).toBe(false);
      expect(err).toContain('Orphaned task ID');
    });
  });

  /**
   * S5: an LWW merge stripped both projectId and tagIds on a task. The app
   * treats "no project and no tag" as corruption because every task must live
   * in at least one list.
   */
  it('S5 — task has neither projectId nor tagIds', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      const task = makeTask({
        id: 'task-5',
        projectId: undefined,
        tagIds: [],
      });
      state.task.ids = [task.id];
      state.task.entities = { [task.id]: task };

      const isValid = isRelatedModelDataValid(state);
      const err = getLastValidityError();

      console.log('[S5]', { isValid, err });
      expect(isValid).toBe(false);
      expect(err).toContain('Task without project or tag');
    });
  });

  /**
   * S6: a regular (non-TODAY) tag's taskIds references a task that was
   * remotely deleted. This is the tag-side mirror of S1.
   */
  it('S6 — tag.taskIds references a deleted task (non-TODAY)', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      (state.tag.entities['tag-1'] as { taskIds: string[] }).taskIds = ['ghost-task'];

      const isValid = isRelatedModelDataValid(state);
      const err = getLastValidityError();

      console.log('[S6]', { isValid, err });
      expect(isValid).toBe(false);
      expect(err).toContain('Inconsistent Task State: Missing task id for tag');
    });
  });

  /**
   * Control: TODAY_TAG orphans are explicitly tolerated (see the special
   * case in is-related-model-data-valid.ts). If this ever starts failing we
   * have a regression in the TODAY_TAG exemption.
   */
  it('control — TODAY_TAG.taskIds orphan is tolerated', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      (state.tag.entities[TODAY_TAG.id] as { taskIds: string[] }).taskIds = [
        'ghost-task',
      ];

      const isValid = isRelatedModelDataValid(state);

      expect(isValid).toBe(true);
    });
  });

  /**
   * Baseline: the skeleton itself must be valid. If this fails the harness is
   * miscalibrated and the other assertions are meaningless.
   */
  it('baseline — empty skeleton is valid', async () => {
    await withProductionMode(() => {
      const state = makeBaseState();
      expect(isRelatedModelDataValid(state)).toBe(true);
    });
  });
});
