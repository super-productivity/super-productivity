/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { DEFAULT_TASK, Task } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { DEFAULT_PROJECT } from '../../../features/project/project.const';
import { DEFAULT_TAG } from '../../../features/tag/tag.const';
import { Action } from '@ngrx/store';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { appStateFeatureKey } from '../../app-state/app-state.reducer';

// =============================================================================
// TEST HELPERS
// =============================================================================

export const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  id: 'task1',
  title: 'Test Task',
  tagIds: ['tag1'],
  projectId: 'project1',
  ...overrides,
});

export const createMockProject = (overrides: Partial<Project> = {}): Project => ({
  ...DEFAULT_PROJECT,
  id: 'project1',
  title: 'Test Project',
  isEnableBacklog: true,
  ...overrides,
});

export const createMockTag = (overrides: Partial<Tag> = {}): Tag => ({
  ...DEFAULT_TAG,
  id: 'tag1',
  title: 'Test Tag',
  ...overrides,
});

export const createBaseState = (): RootState => {
  const mockProject = createMockProject();
  const mockTag = createMockTag();

  return {
    [TASK_FEATURE_NAME]: {
      ids: [],
      entities: {},
      currentTaskId: null,
      selectedTaskId: null,
      taskDetailTargetPanel: null,
      lastCurrentTaskId: null,
      isDataLoaded: false,
    },
    [TAG_FEATURE_NAME]: {
      ids: ['tag1', 'TODAY'],
      entities: {
        tag1: mockTag,
        TODAY: {
          ...mockTag,
          id: 'TODAY',
          title: 'Today',
          taskIds: [],
        },
      },
    },
    [PROJECT_FEATURE_NAME]: {
      ids: ['project1'],
      entities: { project1: mockProject },
    },
    planner: {
      days: {},
      addPlannedTasksDialogLastShown: undefined,
    },
    [appStateFeatureKey]: {
      todayStr: getDbDateStr(),
      startOfNextDayDiffMs: 0,
    },
  } as Partial<RootState> as RootState;
};

export const createStateWithExistingTasks = (
  projectTaskIds: string[] = [],
  projectBacklogIds: string[] = [],
  tagTaskIds: string[] = [],
  todayTaskIds: string[] = [],
): RootState => {
  const baseState = createBaseState();

  // Collect all unique task IDs
  const allTaskIds = [
    ...new Set([...projectTaskIds, ...projectBacklogIds, ...tagTaskIds, ...todayTaskIds]),
  ];

  // Create task entities
  const taskEntities: Record<string, Task> = {};
  const taskIds: string[] = [];

  allTaskIds.forEach((taskId) => {
    taskEntities[taskId] = createMockTask({
      id: taskId,
      tagIds: tagTaskIds.includes(taskId) ? ['tag1'] : [],
      projectId:
        projectTaskIds.includes(taskId) || projectBacklogIds.includes(taskId)
          ? 'project1'
          : undefined,
    });
    taskIds.push(taskId);
  });

  return {
    ...baseState,
    [TASK_FEATURE_NAME]: {
      ...baseState[TASK_FEATURE_NAME],
      ids: taskIds,
      entities: taskEntities,
    },
    [PROJECT_FEATURE_NAME]: {
      ...baseState[PROJECT_FEATURE_NAME],
      entities: {
        ...baseState[PROJECT_FEATURE_NAME].entities,
        project1: {
          ...baseState[PROJECT_FEATURE_NAME].entities.project1,
          taskIds: projectTaskIds,
          backlogTaskIds: projectBacklogIds,
        } as Project,
      },
    },
    [TAG_FEATURE_NAME]: {
      ...baseState[TAG_FEATURE_NAME],
      entities: {
        ...baseState[TAG_FEATURE_NAME].entities,
        tag1: {
          ...baseState[TAG_FEATURE_NAME].entities.tag1,
          taskIds: tagTaskIds,
        } as Tag,
        TODAY: {
          ...baseState[TAG_FEATURE_NAME].entities.TODAY,
          taskIds: todayTaskIds,
        } as Tag,
      },
    },
  };
};

export const expectStateUpdate = (
  expectedState: Record<string, unknown>,
  action: Action,
  mockReducer: jasmine.Spy,
  testState: RootState,
) => {
  expect(mockReducer).toHaveBeenCalledWith(
    jasmine.objectContaining(expectedState),
    action,
  );
};

export const expectProjectUpdate = (projectId: string, changes: Partial<Project>) => ({
  [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
    entities: jasmine.objectContaining({
      [projectId]: jasmine.objectContaining(changes),
    }),
  }),
});

export const expectTagUpdate = (tagId: string, changes: Partial<Tag>) => ({
  [TAG_FEATURE_NAME]: jasmine.objectContaining({
    entities: jasmine.objectContaining({
      [tagId]: jasmine.objectContaining(changes),
    }),
  }),
});

export const expectTagUpdates = (updates: Record<string, Partial<Tag>>) => ({
  [TAG_FEATURE_NAME]: jasmine.objectContaining({
    entities: jasmine.objectContaining(
      Object.fromEntries(
        Object.entries(updates).map(([tagId, changes]) => [
          tagId,
          jasmine.objectContaining(changes),
        ]),
      ),
    ),
  }),
});

export const expectTaskUpdate = (taskId: string, changes: Partial<Task>) => ({
  [TASK_FEATURE_NAME]: jasmine.objectContaining({
    entities: jasmine.objectContaining({
      [taskId]: jasmine.objectContaining(changes),
    }),
  }),
});

export const expectTaskEntityExists = (taskId: string) => ({
  [TASK_FEATURE_NAME]: jasmine.objectContaining({
    entities: jasmine.objectContaining({
      [taskId]: jasmine.anything(),
    }),
    ids: jasmine.arrayContaining([taskId]),
  }),
});

export const expectTaskEntityNotExists = (taskId: string, baseState: RootState) => ({
  [TASK_FEATURE_NAME]: jasmine.objectContaining({
    entities: jasmine.objectContaining(
      Object.fromEntries(
        Object.keys(baseState[TASK_FEATURE_NAME].entities)
          .filter((id) => id !== taskId)
          .map((id) => [id, jasmine.anything()]),
      ),
    ),
  }),
});
