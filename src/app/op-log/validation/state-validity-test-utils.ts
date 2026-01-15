/**
 * Utilities for testing state validity after reducer actions.
 * These helpers construct valid AppDataComplete states and
 * validate them using the same validation functions used in production.
 */
import { AppDataComplete } from '../model/model-config';
import { validateFull } from './validation-fn';
import { initialTaskState } from '../../features/tasks/store/task.reducer';
import { initialProjectState } from '../../features/project/store/project.reducer';
import { initialTagState } from '../../features/tag/store/tag.reducer';
import { initialNoteState } from '../../features/note/store/note.reducer';
import { initialSimpleCounterState } from '../../features/simple-counter/store/simple-counter.reducer';
import { initialTaskRepeatCfgState } from '../../features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import { plannerInitialState } from '../../features/planner/store/planner.reducer';
import { initialBoardsState } from '../../features/boards/store/boards.reducer';
import { issueProviderInitialState } from '../../features/issue/store/issue-provider.reducer';
import { initialMetricState } from '../../features/metric/store/metric.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { menuTreeInitialState } from '../../features/menu-tree/store/menu-tree.reducer';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { DEFAULT_PROJECT } from '../../features/project/project.const';
import { DEFAULT_TAG } from '../../features/tag/tag.const';
import { DEFAULT_TASK, Task } from '../../features/tasks/task.model';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';
import { Note } from '../../features/note/note.model';
import {
  MenuTreeKind,
  MenuTreeProjectNode,
  MenuTreeTagNode,
} from '../../features/menu-tree/store/menu-tree.model';
import { RootState } from '../../root-store/root-state';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../features/tag/store/tag.reducer';
import { NOTE_FEATURE_NAME } from '../../features/note/store/note.reducer';
import { CONFIG_FEATURE_NAME } from '../../features/config/store/global-config.reducer';
import { BOARDS_FEATURE_NAME } from '../../features/boards/store/boards.reducer';
import { menuTreeFeatureKey } from '../../features/menu-tree/store/menu-tree.reducer';
import { plannerFeatureKey } from '../../features/planner/store/planner.reducer';
import { TIME_TRACKING_FEATURE_KEY } from '../../features/time-tracking/store/time-tracking.reducer';

/**
 * Creates a minimal valid AppDataComplete state.
 * Contains one project (INBOX) and the TODAY tag.
 */
export const createValidAppData = (
  overrides: Partial<AppDataComplete> = {},
): AppDataComplete => {
  const inboxProject: Project = {
    ...DEFAULT_PROJECT,
    id: 'INBOX',
    title: 'Inbox',
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
  };

  const todayTag: Tag = {
    ...DEFAULT_TAG,
    id: 'TODAY',
    title: 'Today',
    taskIds: [],
  };

  return {
    task: {
      ...initialTaskState,
      ids: [],
      entities: {},
    },
    project: {
      ...initialProjectState,
      ids: ['INBOX'],
      entities: { INBOX: inboxProject },
    },
    tag: {
      ...initialTagState,
      ids: ['TODAY'],
      entities: { TODAY: todayTag },
    },
    note: {
      ...initialNoteState,
      ids: [],
      entities: {},
      todayOrder: [],
    },
    menuTree: {
      ...menuTreeInitialState,
      projectTree: [{ k: MenuTreeKind.PROJECT, id: 'INBOX' } as MenuTreeProjectNode],
      tagTree: [{ k: MenuTreeKind.TAG, id: 'TODAY' } as MenuTreeTagNode],
    },
    globalConfig: DEFAULT_GLOBAL_CONFIG,
    simpleCounter: initialSimpleCounterState,
    taskRepeatCfg: initialTaskRepeatCfgState,
    reminders: [],
    planner: plannerInitialState,
    boards: initialBoardsState,
    issueProvider: issueProviderInitialState,
    metric: initialMetricState,
    timeTracking: initialTimeTrackingState,
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
    ...overrides,
  };
};

/**
 * Creates a task with required fields for validity.
 */
export const createValidTask = (id: string, overrides: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  id,
  title: `Task ${id}`,
  created: Date.now(),
  isDone: false,
  subTaskIds: [],
  tagIds: [],
  projectId: 'INBOX',
  parentId: undefined,
  timeSpentOnDay: {},
  timeEstimate: 0,
  timeSpent: 0,
  dueDay: undefined,
  dueWithTime: undefined,
  attachments: [],
  ...overrides,
});

/**
 * Creates a project with required fields for validity.
 */
export const createValidProject = (
  id: string,
  overrides: Partial<Project> = {},
): Project => ({
  ...DEFAULT_PROJECT,
  id,
  title: `Project ${id}`,
  taskIds: [],
  backlogTaskIds: [],
  noteIds: [],
  ...overrides,
});

/**
 * Creates a tag with required fields for validity.
 */
export const createValidTag = (id: string, overrides: Partial<Tag> = {}): Tag => ({
  ...DEFAULT_TAG,
  id,
  title: `Tag ${id}`,
  taskIds: [],
  ...overrides,
});

/**
 * Creates a note with required fields for validity.
 */
export const createValidNote = (
  id: string,
  projectId: string,
  overrides: Partial<Note> = {},
): Note => ({
  id,
  projectId,
  content: `Note ${id}`,
  created: Date.now(),
  modified: Date.now(),
  isPinnedToToday: false,
  ...overrides,
});

/**
 * Adds a task to the app data, updating all relevant references.
 */
export const addTaskToAppData = (data: AppDataComplete, task: Task): AppDataComplete => {
  const newData = { ...data };

  // Add task to task state
  newData.task = {
    ...data.task,
    ids: [...(data.task.ids as string[]), task.id],
    entities: {
      ...data.task.entities,
      [task.id]: task,
    },
  };

  // Add to project if has projectId
  if (task.projectId && !task.parentId) {
    const project = data.project.entities[task.projectId];
    if (project) {
      newData.project = {
        ...data.project,
        entities: {
          ...data.project.entities,
          [task.projectId]: {
            ...project,
            taskIds: [...project.taskIds, task.id],
          },
        },
      };
    }
  }

  // Add to tags if has tagIds
  if (task.tagIds.length > 0 && !task.parentId) {
    const newTagEntities = { ...data.tag.entities };
    for (const tagId of task.tagIds) {
      const tag = newTagEntities[tagId];
      if (tag) {
        newTagEntities[tagId] = {
          ...tag,
          taskIds: [...tag.taskIds, task.id],
        };
      }
    }
    newData.tag = {
      ...data.tag,
      entities: newTagEntities,
    };
  }

  return newData;
};

/**
 * Adds a project to the app data, updating menu tree.
 */
export const addProjectToAppData = (
  data: AppDataComplete,
  project: Project,
): AppDataComplete => {
  const newProjectNode: MenuTreeProjectNode = {
    k: MenuTreeKind.PROJECT,
    id: project.id,
  };
  return {
    ...data,
    project: {
      ...data.project,
      ids: [...(data.project.ids as string[]), project.id],
      entities: {
        ...data.project.entities,
        [project.id]: project,
      },
    },
    menuTree: {
      ...data.menuTree,
      projectTree: [...data.menuTree.projectTree, newProjectNode],
    },
  };
};

/**
 * Adds a tag to the app data, updating menu tree.
 */
export const addTagToAppData = (data: AppDataComplete, tag: Tag): AppDataComplete => {
  const newTagNode: MenuTreeTagNode = {
    k: MenuTreeKind.TAG,
    id: tag.id,
  };
  return {
    ...data,
    tag: {
      ...data.tag,
      ids: [...(data.tag.ids as string[]), tag.id],
      entities: {
        ...data.tag.entities,
        [tag.id]: tag,
      },
    },
    menuTree: {
      ...data.menuTree,
      tagTree: [...data.menuTree.tagTree, newTagNode],
    },
  };
};

/**
 * Validates AppDataComplete and returns detailed result.
 */
export const validateAppData = (
  data: AppDataComplete,
): { isValid: boolean; error?: string } => {
  const result = validateFull(data);

  if (result.isValid) {
    return { isValid: true };
  }

  let error = 'Validation failed';
  if (!result.typiaResult.success) {
    const errors = (result.typiaResult as any).errors || [];
    error = `Typia validation failed: ${JSON.stringify(errors.slice(0, 3))}`;
  } else if (result.crossModelError) {
    error = `Cross-model validation failed: ${result.crossModelError}`;
  }

  return { isValid: false, error };
};

/**
 * Converts RootState (NgRx store state) to AppDataComplete format.
 * This is needed for validation since validation works on AppDataComplete.
 */
export const rootStateToAppData = (
  state: RootState,
  additionalData: {
    archiveYoung?: AppDataComplete['archiveYoung'];
    archiveOld?: AppDataComplete['archiveOld'];
    simpleCounter?: AppDataComplete['simpleCounter'];
    taskRepeatCfg?: AppDataComplete['taskRepeatCfg'];
    issueProvider?: AppDataComplete['issueProvider'];
    metric?: AppDataComplete['metric'];
    reminders?: AppDataComplete['reminders'];
    pluginUserData?: AppDataComplete['pluginUserData'];
    pluginMetadata?: AppDataComplete['pluginMetadata'];
  } = {},
): AppDataComplete => {
  return {
    task: state[TASK_FEATURE_NAME],
    project: state[PROJECT_FEATURE_NAME],
    tag: state[TAG_FEATURE_NAME],
    note: state[NOTE_FEATURE_NAME],
    menuTree: state[menuTreeFeatureKey],
    globalConfig: state[CONFIG_FEATURE_NAME],
    planner: state[plannerFeatureKey],
    boards: state[BOARDS_FEATURE_NAME],
    timeTracking: state[TIME_TRACKING_FEATURE_KEY],
    // These are either from additional data or defaults
    simpleCounter: additionalData.simpleCounter || initialSimpleCounterState,
    taskRepeatCfg: additionalData.taskRepeatCfg || initialTaskRepeatCfgState,
    issueProvider: additionalData.issueProvider || issueProviderInitialState,
    metric: additionalData.metric || initialMetricState,
    reminders: additionalData.reminders || [],
    pluginUserData: additionalData.pluginUserData || [],
    pluginMetadata: additionalData.pluginMetadata || [],
    archiveYoung: additionalData.archiveYoung || {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
    archiveOld: additionalData.archiveOld || {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
  };
};

/**
 * Creates a valid RootState from AppDataComplete.
 * Used for testing reducers that work on RootState.
 */
export const appDataToRootState = (data: AppDataComplete): RootState => {
  return {
    [TASK_FEATURE_NAME]: data.task,
    [PROJECT_FEATURE_NAME]: data.project,
    [TAG_FEATURE_NAME]: data.tag,
    [NOTE_FEATURE_NAME]: data.note,
    [menuTreeFeatureKey]: data.menuTree,
    [CONFIG_FEATURE_NAME]: data.globalConfig,
    [plannerFeatureKey]: data.planner,
    [BOARDS_FEATURE_NAME]: data.boards,
    [TIME_TRACKING_FEATURE_KEY]: data.timeTracking,
  } as RootState;
};

/**
 * Creates AppData with one project, tag, and task properly connected.
 * This is the most common starting point for action tests.
 */
export const createAppDataWithTask = (
  taskId: string = 'task1',
  projectId: string = 'INBOX',
): AppDataComplete => {
  const task = createValidTask(taskId, { projectId });
  const baseData = createValidAppData();

  // Ensure project has the task in its taskIds
  const updatedProject = {
    ...baseData.project.entities[projectId]!,
    taskIds: [taskId],
  };

  return {
    ...baseData,
    task: {
      ...baseData.task,
      ids: [taskId],
      entities: { [taskId]: task },
    },
    project: {
      ...baseData.project,
      entities: {
        ...baseData.project.entities,
        [projectId]: updatedProject,
      },
    },
  };
};

/**
 * Creates AppData with subtasks.
 */
export const createAppDataWithSubtasks = (
  parentId: string = 'parent1',
  subtaskIds: string[] = ['sub1', 'sub2'],
  projectId: string = 'INBOX',
): AppDataComplete => {
  const parentTask = createValidTask(parentId, {
    projectId,
    subTaskIds: subtaskIds,
  });

  const subtasks = subtaskIds.map((id) =>
    createValidTask(id, {
      projectId,
      parentId,
    }),
  );

  const baseData = createValidAppData();

  const allTasks = [parentTask, ...subtasks];
  const taskEntities = Object.fromEntries(allTasks.map((t) => [t.id, t]));

  // Update project with parent task only (subtasks are not in project lists)
  const updatedProject = {
    ...baseData.project.entities[projectId]!,
    taskIds: [parentId],
  };

  return {
    ...baseData,
    task: {
      ...baseData.task,
      ids: [parentId, ...subtaskIds],
      entities: taskEntities,
    },
    project: {
      ...baseData.project,
      entities: {
        ...baseData.project.entities,
        [projectId]: updatedProject,
      },
    },
  };
};
