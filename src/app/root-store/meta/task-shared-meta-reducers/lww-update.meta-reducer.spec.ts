import { Action } from '@ngrx/store';
import { lwwUpdateMetaReducer } from './lww-update.meta-reducer';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Project } from '../../../features/project/project.model';
import { Tag } from '../../../features/tag/tag.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { OpLog } from '../../../core/log';
import { CONFIG_FEATURE_NAME } from '../../../features/config/store/global-config.reducer';
import { TIME_TRACKING_FEATURE_KEY } from '../../../features/time-tracking/store/time-tracking.reducer';

describe('lwwUpdateMetaReducer', () => {
  const mockReducer = jasmine.createSpy('reducer');
  const reducer = lwwUpdateMetaReducer(mockReducer);

  const TASK_ID = 'task1';
  const PROJECT_ID = 'project1';
  const TAG_ID = 'tag1';

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: TASK_ID,
      title: 'Original Title',
      notes: '',
      timeEstimate: 0,
      timeSpent: 0,
      timeSpentOnDay: {},
      reminderId: null,
      plannedAt: null,
      dueDay: null,
      dueWithTime: null,
      projectId: null,
      issueId: null,
      issueProviderId: null,
      issueType: null,
      issueLastUpdated: null,
      issuePoints: null,
      issueAttachmentNr: null,
      issueWasUpdated: false,
      issueTimeTracked: null,
      issueLinkType: null,
      tagIds: [],
      parentId: null,
      subTaskIds: [],
      attachmentIds: [],
      done: false,
      doneOn: null,
      modified: 1000,
      created: 1000,
      repeatCfgId: null,
      issueData: null,
      isDone: false,
      _showSubTasksMode: 2,
      ...overrides,
    }) as Task;

  const createMockProject = (overrides: Partial<Project> = {}): Project =>
    ({
      id: PROJECT_ID,
      title: 'Original Project',
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
      isHiddenFromMenu: false,
      isArchived: false,
      isEnableBacklog: false,
      issueIntegrationCfgs: {},
      theme: {},
      ...overrides,
    }) as Project;

  const createMockTag = (overrides: Partial<Tag> = {}): Tag =>
    ({
      id: TAG_ID,
      title: 'Original Tag',
      taskIds: [],
      color: '#ff0000',
      icon: null,
      ...overrides,
    }) as Tag;

  const createMockState = (taskOverrides?: Partial<Task>[]): Partial<RootState> =>
    ({
      [TASK_FEATURE_NAME]: {
        ids: [TASK_ID],
        entities: {
          [TASK_ID]: createMockTask(taskOverrides?.[0]),
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
          [PROJECT_ID]: createMockProject(),
        },
      },
      [TAG_FEATURE_NAME]: {
        ids: [TAG_ID],
        entities: {
          [TAG_ID]: createMockTag(),
        },
      },
    }) as Partial<RootState>;

  beforeEach(() => {
    mockReducer.calls.reset();
    mockReducer.and.callFake((state: unknown, _action: Action) => state);
  });

  describe('non-LWW Update actions', () => {
    it('should pass through non-LWW Update actions unchanged', () => {
      const state = createMockState();
      const action = { type: '[Task] Update Task', task: { id: TASK_ID, changes: {} } };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalledWith(state, action);
    });

    it('should pass through actions with similar but non-matching types', () => {
      const state = createMockState();
      const action = { type: '[TASK] Some Other Action' };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalledWith(state, action);
    });
  });

  describe('[TASK] LWW Update', () => {
    it('should update task entity with LWW winning state', () => {
      const state = createMockState();
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        title: 'LWW Winning Title',
        notes: 'Updated notes',
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: TASK_ID,
          isRemote: true,
        },
      };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const updatedTask = updatedState[TASK_FEATURE_NAME]?.entities[TASK_ID] as Task;
      expect(updatedTask.title).toBe('LWW Winning Title');
      expect(updatedTask.notes).toBe('Updated notes');
    });

    it('should update modified timestamp', () => {
      const state = createMockState([{ modified: 1000 }]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        title: 'Updated Title',
        modified: 1000, // Original timestamp in action
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: TASK_ID,
          isRemote: true,
        },
      };

      const beforeTime = Date.now();
      reducer(state, action);
      const afterTime = Date.now();

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const updatedTask = updatedState[TASK_FEATURE_NAME]?.entities[TASK_ID] as Task;
      expect(updatedTask.modified).toBeGreaterThanOrEqual(beforeTime);
      expect(updatedTask.modified).toBeLessThanOrEqual(afterTime);
    });

    it('should recreate entity if it does not exist (LWW update won over delete)', () => {
      const state = createMockState();
      const action = {
        type: '[TASK] LWW Update',
        id: 'recreated-task',
        title: 'Recreated Task Title',
        notes: 'This task was deleted locally but update won via LWW',
        isDone: true,
        doneOn: 12345,
        meta: { isPersistent: true, entityType: 'TASK', entityId: 'recreated-task' },
      };

      spyOn(OpLog, 'log');
      reducer(state, action);

      expect(OpLog.log).toHaveBeenCalledWith(
        jasmine.stringMatching(
          /Entity TASK:recreated-task not found, recreating from LWW update/,
        ),
      );
      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const recreatedTask = updatedState[TASK_FEATURE_NAME]?.entities[
        'recreated-task'
      ] as Task;
      expect(recreatedTask).toBeDefined();
      expect(recreatedTask.id).toBe('recreated-task');
      expect(recreatedTask.title).toBe('Recreated Task Title');
      expect(recreatedTask.notes).toBe(
        'This task was deleted locally but update won via LWW',
      );
      expect(recreatedTask.isDone).toBe(true);
      expect(recreatedTask.doneOn).toBe(12345);
    });

    it('should add recreated entity to the ids array', () => {
      const state = createMockState();
      const action = {
        type: '[TASK] LWW Update',
        id: 'new-task-from-lww',
        title: 'New Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: 'new-task-from-lww' },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      expect(updatedState[TASK_FEATURE_NAME]?.ids).toContain('new-task-from-lww');
    });

    it('should skip update if action has no id', () => {
      const state = createMockState();
      const action = {
        type: '[TASK] LWW Update',
        title: 'Updated Title',
        meta: { isPersistent: true, entityType: 'TASK' },
      };

      spyOn(OpLog, 'warn');
      reducer(state, action);

      expect(OpLog.warn).toHaveBeenCalledWith(
        jasmine.stringMatching(/Entity data has no id/),
      );
      expect(mockReducer).toHaveBeenCalledWith(state, action);
    });
  });

  describe('[PROJECT] LWW Update', () => {
    it('should update project entity with LWW winning state', () => {
      const state = createMockState();
      const action = {
        type: '[PROJECT] LWW Update',
        id: PROJECT_ID,
        title: 'LWW Winning Project Title',
        meta: {
          isPersistent: true,
          entityType: 'PROJECT',
          entityId: PROJECT_ID,
          isRemote: true,
        },
      };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const updatedProject = updatedState[PROJECT_FEATURE_NAME]?.entities[
        PROJECT_ID
      ] as Project;
      expect(updatedProject.title).toBe('LWW Winning Project Title');
    });
  });

  describe('[TAG] LWW Update', () => {
    it('should update tag entity with LWW winning state', () => {
      const state = createMockState();
      const action = {
        type: '[TAG] LWW Update',
        id: TAG_ID,
        title: 'LWW Winning Tag Title',
        color: '#00ff00',
        meta: {
          isPersistent: true,
          entityType: 'TAG',
          entityId: TAG_ID,
          isRemote: true,
        },
      };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const updatedTag = updatedState[TAG_FEATURE_NAME]?.entities[TAG_ID] as Tag;
      expect(updatedTag.title).toBe('LWW Winning Tag Title');
      expect(updatedTag.color).toBe('#00ff00');
    });
  });

  describe('unknown entity types', () => {
    it('should pass through for unknown entity types without warning', () => {
      const state = createMockState();
      const action = {
        type: '[UNKNOWN_ENTITY] LWW Update',
        id: 'unknown-1',
        title: 'Updated Title',
        meta: { isPersistent: true, entityType: 'UNKNOWN_ENTITY', entityId: 'unknown-1' },
      };

      // Unknown entity types are not in the LWW_UPDATE_ACTION_TYPES set,
      // so they silently pass through as non-LWW actions.
      reducer(state, action);

      expect(mockReducer).toHaveBeenCalledWith(state, action);
    });
  });

  describe('singleton entity LWW Updates', () => {
    const createMockStateWithSingletons = (): Partial<RootState> =>
      ({
        ...createMockState(),
        globalConfig: {
          misc: {
            isDisableAnimations: false,
            isDisableCelebration: false,
          },
          sound: { isEnabled: true },
        },
        timeTracking: {
          currentSessionTime: 0,
          isTrackingReminder: true,
        },
      }) as unknown as Partial<RootState>;

    it('should replace globalConfig state with LWW winning data', () => {
      const state = createMockStateWithSingletons();
      const action = {
        type: '[GLOBAL_CONFIG] LWW Update',
        misc: {
          isDisableAnimations: true,
          isDisableCelebration: true,
        },
        sound: { isEnabled: false },
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG',
          isRemote: true,
        },
      };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Record<
        string,
        unknown
      >;
      const globalConfig = updatedState[CONFIG_FEATURE_NAME] as Record<string, unknown>;
      expect(globalConfig).toBeDefined();
      expect(
        (globalConfig['misc'] as Record<string, unknown>)['isDisableAnimations'],
      ).toBe(true);
      expect(
        (globalConfig['misc'] as Record<string, unknown>)['isDisableCelebration'],
      ).toBe(true);
      expect((globalConfig['sound'] as Record<string, unknown>)['isEnabled']).toBe(false);
    });

    it('should fully replace state, not merge with existing', () => {
      const state = createMockStateWithSingletons();
      const action = {
        type: '[GLOBAL_CONFIG] LWW Update',
        misc: { isDisableAnimations: true },
        meta: { isPersistent: true, entityType: 'GLOBAL_CONFIG', isRemote: true },
      };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Record<
        string,
        unknown
      >;
      const globalConfig = updatedState[CONFIG_FEATURE_NAME] as Record<string, unknown>;
      // 'sound' was in the original state but not in the action payload — it must be gone
      expect(globalConfig['sound']).toBeUndefined();
      // 'misc' was in the payload — it must be present
      expect(globalConfig['misc']).toBeDefined();
    });

    it('should replace timeTracking state with LWW winning data', () => {
      const state = createMockStateWithSingletons();
      const action = {
        type: '[TIME_TRACKING] LWW Update',
        currentSessionTime: 5000,
        isTrackingReminder: false,
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING',
          isRemote: true,
        },
      };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Record<
        string,
        unknown
      >;
      const timeTracking = updatedState[TIME_TRACKING_FEATURE_KEY] as Record<
        string,
        unknown
      >;
      expect(timeTracking).toBeDefined();
      expect(timeTracking['currentSessionTime']).toBe(5000);
      expect(timeTracking['isTrackingReminder']).toBe(false);
    });

    it('should not require id field for singleton entities', () => {
      const state = createMockStateWithSingletons();
      const action = {
        type: '[GLOBAL_CONFIG] LWW Update',
        misc: { isDisableAnimations: true },
        meta: { isPersistent: true, entityType: 'GLOBAL_CONFIG', isRemote: true },
      };

      spyOn(OpLog, 'warn');
      reducer(state, action);

      expect(OpLog.warn).not.toHaveBeenCalledWith(
        jasmine.stringMatching(/Entity data has no id/),
      );
      const updatedState = mockReducer.calls.mostRecent().args[0] as Record<
        string,
        unknown
      >;
      const globalConfig = updatedState[CONFIG_FEATURE_NAME] as Record<string, unknown>;
      expect(globalConfig['misc']).toBeDefined();
    });

    it('should strip type and meta from applied singleton state', () => {
      const state = createMockStateWithSingletons();
      const action = {
        type: '[GLOBAL_CONFIG] LWW Update',
        misc: { isDisableAnimations: true },
        meta: { isPersistent: true, entityType: 'GLOBAL_CONFIG', isRemote: true },
      };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalled();
      const updatedState = mockReducer.calls.mostRecent().args[0] as Record<
        string,
        unknown
      >;
      const globalConfig = updatedState[CONFIG_FEATURE_NAME] as Record<string, unknown>;
      expect(globalConfig['type']).toBeUndefined();
      expect(globalConfig['meta']).toBeUndefined();
    });

    it('should not replace singleton state with empty data', () => {
      const state = createMockStateWithSingletons();
      // Action with only type and meta — no actual entity data
      const action = {
        type: '[GLOBAL_CONFIG] LWW Update',
        meta: { isPersistent: true, entityType: 'GLOBAL_CONFIG', isRemote: true },
      };

      spyOn(OpLog, 'warn');
      // Prevent devError from throwing (it calls alert + confirm → throws if true)
      if (!jasmine.isSpy(window.alert)) {
        spyOn(window, 'alert');
      }
      if (!jasmine.isSpy(window.confirm)) {
        spyOn(window, 'confirm').and.returnValue(false);
      } else {
        (window.confirm as jasmine.Spy).and.returnValue(false);
      }
      reducer(state, action);

      expect(OpLog.warn).toHaveBeenCalledWith(
        jasmine.stringMatching(/Empty singleton data/),
      );
      // State should be passed through unchanged
      expect(mockReducer).toHaveBeenCalledWith(state, action);
    });
  });

  describe('null/undefined state', () => {
    it('should pass through if state is undefined', () => {
      const action = { type: '[TASK] LWW Update', id: TASK_ID };

      reducer(undefined, action);

      expect(mockReducer).toHaveBeenCalledWith(undefined, action);
    });
  });

  describe('project.taskIds sync on task projectId change', () => {
    const PROJECT_A = 'project-a';
    const PROJECT_B = 'project-b';

    const createStateWithProjects = (
      taskProjectId: string | undefined,
      projectATaskIds: string[],
      projectBTaskIds: string[],
    ): Partial<RootState> =>
      ({
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ projectId: taskProjectId }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_A, PROJECT_B],
          entities: {
            [PROJECT_A]: createMockProject({
              id: PROJECT_A,
              title: 'Project A',
              taskIds: projectATaskIds,
            }),
            [PROJECT_B]: createMockProject({
              id: PROJECT_B,
              title: 'Project B',
              taskIds: projectBTaskIds,
            }),
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      }) as Partial<RootState>;

    it('should move task from old project to new project when projectId changes', () => {
      // Task is in Project A, LWW update moves it to Project B
      const state = createStateWithProjects(PROJECT_A, [TASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_B,
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;
      const projectB = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_B] as Project;

      expect(projectA.taskIds).not.toContain(TASK_ID);
      expect(projectB.taskIds).toContain(TASK_ID);
    });

    it('should remove task from old project backlogTaskIds when projectId changes', () => {
      // Task is in Project A's backlog, LWW update moves it to Project B
      const state = {
        ...createStateWithProjects(PROJECT_A, [], []),
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_A, PROJECT_B],
          entities: {
            [PROJECT_A]: createMockProject({
              id: PROJECT_A,
              title: 'Project A',
              taskIds: [],
              backlogTaskIds: [TASK_ID],
            }),
            [PROJECT_B]: createMockProject({
              id: PROJECT_B,
              title: 'Project B',
              taskIds: [],
            }),
          },
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_B,
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;
      const projectB = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_B] as Project;

      expect(projectA.backlogTaskIds).not.toContain(TASK_ID);
      expect(projectB.taskIds).toContain(TASK_ID);
    });

    it('should not duplicate task in project.taskIds if already present', () => {
      // Task is already in Project B's taskIds (edge case)
      const state = createStateWithProjects(PROJECT_A, [TASK_ID], [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_B,
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectB = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_B] as Project;

      // Should still only have one instance
      expect(projectB.taskIds.filter((id) => id === TASK_ID).length).toBe(1);
    });

    it('should not update project.taskIds for subtasks', () => {
      // Subtask should not be added to project.taskIds
      const state = {
        ...createStateWithProjects(PROJECT_A, [], []),
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ projectId: PROJECT_A, parentId: 'parent-task' }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_B,
        parentId: 'parent-task',
        title: 'Updated Subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectB = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_B] as Project;

      // Subtask should NOT be added to project.taskIds
      expect(projectB.taskIds).not.toContain(TASK_ID);
    });

    it('should handle projectId change when old project does not exist', () => {
      // Old project was deleted, new project exists
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ projectId: 'deleted-project' }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_B],
          entities: {
            [PROJECT_B]: createMockProject({ id: PROJECT_B, title: 'Project B' }),
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_B,
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      // Should not throw
      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectB = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_B] as Project;

      expect(projectB.taskIds).toContain(TASK_ID);
    });

    it('should not update projects when projectId does not change', () => {
      const state = createStateWithProjects(PROJECT_A, [TASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_A, // Same as existing
        title: 'Updated Task Title Only',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;
      const projectB = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_B] as Project;

      // Project A should still have the task
      expect(projectA.taskIds).toContain(TASK_ID);
      // Project B should still be empty
      expect(projectB.taskIds).not.toContain(TASK_ID);
    });
  });

  describe('tag.taskIds sync on task tagIds change', () => {
    const TAG_A = 'tag-a';
    const TAG_B = 'tag-b';
    const TAG_C = 'tag-c';

    const createStateWithTags = (
      taskTagIds: string[],
      tagATaskIds: string[],
      tagBTaskIds: string[],
      tagCTaskIds: string[] = [],
    ): Partial<RootState> =>
      ({
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ tagIds: taskTagIds }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [TAG_A, TAG_B, TAG_C],
          entities: {
            [TAG_A]: createMockTag({
              id: TAG_A,
              title: 'Tag A',
              taskIds: tagATaskIds,
            }),
            [TAG_B]: createMockTag({
              id: TAG_B,
              title: 'Tag B',
              taskIds: tagBTaskIds,
            }),
            [TAG_C]: createMockTag({
              id: TAG_C,
              title: 'Tag C',
              taskIds: tagCTaskIds,
            }),
          },
        },
      }) as Partial<RootState>;

    it('should add task to tag.taskIds when tag is added to task.tagIds', () => {
      // Task has Tag A, LWW update adds Tag B
      const state = createStateWithTags([TAG_A], [TASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_A, TAG_B],
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;
      const tagB = updatedState[TAG_FEATURE_NAME]?.entities[TAG_B] as Tag;

      expect(tagA.taskIds).toContain(TASK_ID);
      expect(tagB.taskIds).toContain(TASK_ID);
    });

    it('should remove task from tag.taskIds when tag is removed from task.tagIds', () => {
      // Task has Tag A and Tag B, LWW update removes Tag B
      const state = createStateWithTags([TAG_A, TAG_B], [TASK_ID], [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_A], // Tag B removed
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;
      const tagB = updatedState[TAG_FEATURE_NAME]?.entities[TAG_B] as Tag;

      expect(tagA.taskIds).toContain(TASK_ID);
      expect(tagB.taskIds).not.toContain(TASK_ID);
    });

    it('should handle complete tag replacement', () => {
      // Task has Tag A, LWW update replaces with Tag B and Tag C
      const state = createStateWithTags([TAG_A], [TASK_ID], [], []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_B, TAG_C], // Tag A removed, Tag B and C added
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;
      const tagB = updatedState[TAG_FEATURE_NAME]?.entities[TAG_B] as Tag;
      const tagC = updatedState[TAG_FEATURE_NAME]?.entities[TAG_C] as Tag;

      expect(tagA.taskIds).not.toContain(TASK_ID);
      expect(tagB.taskIds).toContain(TASK_ID);
      expect(tagC.taskIds).toContain(TASK_ID);
    });

    it('should not duplicate task in tag.taskIds if already present', () => {
      // Task already in Tag B's taskIds (edge case)
      const state = createStateWithTags([TAG_A], [TASK_ID], [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_A, TAG_B],
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagB = updatedState[TAG_FEATURE_NAME]?.entities[TAG_B] as Tag;

      // Should still only have one instance
      expect(tagB.taskIds.filter((id) => id === TASK_ID).length).toBe(1);
    });

    it('should handle tag that does not exist gracefully', () => {
      // Task references a non-existent tag
      const state = createStateWithTags([TAG_A], [TASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_A, 'non-existent-tag'],
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      // Should not throw
      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;

      expect(tagA.taskIds).toContain(TASK_ID);
    });

    it('should not update tags when tagIds does not change', () => {
      const state = createStateWithTags([TAG_A, TAG_B], [TASK_ID], [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_A, TAG_B], // Same as existing
        title: 'Updated Task Title Only',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;
      const tagB = updatedState[TAG_FEATURE_NAME]?.entities[TAG_B] as Tag;
      const tagC = updatedState[TAG_FEATURE_NAME]?.entities[TAG_C] as Tag;

      // Tags should remain unchanged
      expect(tagA.taskIds).toContain(TASK_ID);
      expect(tagB.taskIds).toContain(TASK_ID);
      expect(tagC.taskIds).not.toContain(TASK_ID);
    });

    it('should handle task with no previous tags getting tags', () => {
      const state = createStateWithTags([], [], []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_A, TAG_B],
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;
      const tagB = updatedState[TAG_FEATURE_NAME]?.entities[TAG_B] as Tag;

      expect(tagA.taskIds).toContain(TASK_ID);
      expect(tagB.taskIds).toContain(TASK_ID);
    });

    it('should handle task losing all tags', () => {
      const state = createStateWithTags([TAG_A, TAG_B], [TASK_ID], [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [], // All tags removed
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;
      const tagB = updatedState[TAG_FEATURE_NAME]?.entities[TAG_B] as Tag;

      expect(tagA.taskIds).not.toContain(TASK_ID);
      expect(tagB.taskIds).not.toContain(TASK_ID);
    });

    it('should preserve tag.taskIds order when adding task to tag', () => {
      // Tag A already has some tasks in specific order
      const existingTasks = ['existing-1', 'existing-2', 'existing-3'];
      const state = {
        ...createStateWithTags([], [], []),
        [TAG_FEATURE_NAME]: {
          ids: [TAG_A],
          entities: {
            [TAG_A]: createMockTag({
              id: TAG_A,
              title: 'Tag A',
              taskIds: existingTasks,
            }),
          },
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [TAG_A], // Adding task to TAG_A
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;

      // Original order should be preserved, new task appended at end
      expect(tagA.taskIds).toEqual([...existingTasks, TASK_ID]);
    });

    it('should preserve tag.taskIds order when removing task from tag', () => {
      // Tag A has tasks in specific order, including TASK_ID
      const state = {
        ...createStateWithTags([TAG_A], [], []),
        [TAG_FEATURE_NAME]: {
          ids: [TAG_A],
          entities: {
            [TAG_A]: createMockTag({
              id: TAG_A,
              title: 'Tag A',
              taskIds: ['first', TASK_ID, 'last'],
            }),
          },
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        tagIds: [], // Removing TAG_A from task
        title: 'Updated Task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const tagA = updatedState[TAG_FEATURE_NAME]?.entities[TAG_A] as Tag;

      // Order should be preserved after removal
      expect(tagA.taskIds).toEqual(['first', 'last']);
    });
  });

  describe('subtask edge cases', () => {
    const PARENT_TASK = 'parent-task';
    const SUBTASK_ID = 'subtask-1';
    const PROJECT_A = 'project-a';

    it('should handle subtask with parentId referencing deleted parent gracefully', () => {
      // Subtask references a parent that no longer exists in state
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [SUBTASK_ID],
          entities: {
            [SUBTASK_ID]: createMockTask({
              id: SUBTASK_ID,
              parentId: PARENT_TASK, // Parent no longer exists
              projectId: PROJECT_A,
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_A],
          entities: {
            [PROJECT_A]: createMockProject({ id: PROJECT_A, taskIds: [] }),
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: PARENT_TASK, // Still references deleted parent
        projectId: PROJECT_A,
        title: 'Updated Subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      // Should not throw
      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const subtask = updatedState[TASK_FEATURE_NAME]?.entities[SUBTASK_ID] as Task;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;

      // Subtask should be updated
      expect(subtask.title).toBe('Updated Subtask');
      expect(subtask.parentId).toBe(PARENT_TASK);

      // Subtask should NOT be added to project.taskIds (subtasks are excluded)
      expect(projectA.taskIds).not.toContain(SUBTASK_ID);
    });

    it('should handle subtask becoming orphan (parentId removed via LWW)', () => {
      // Subtask loses its parent via LWW update
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [SUBTASK_ID],
          entities: {
            [SUBTASK_ID]: createMockTask({
              id: SUBTASK_ID,
              parentId: PARENT_TASK,
              projectId: PROJECT_A,
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_A],
          entities: {
            [PROJECT_A]: createMockProject({ id: PROJECT_A, taskIds: [] }),
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: null, // Parent removed - becomes top-level task
        projectId: PROJECT_A,
        title: 'Now a top-level task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const subtask = updatedState[TASK_FEATURE_NAME]?.entities[SUBTASK_ID] as Task;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;

      // Task should now be a top-level task
      expect(subtask.parentId).toBeNull();
      // Since it's no longer a subtask and wasn't before in project.taskIds,
      // and it's changing projectId (even though it's the same), it should be added
      // Actually - it WAS a subtask (existingEntity.parentId exists) so isSubTask = true
      // Therefore it still won't be added
      expect(projectA.taskIds).not.toContain(SUBTASK_ID);
    });

    it('should recognize task as subtask based on existing parentId even if new data has no parentId', () => {
      // This tests the isSubTask check: (entityData['parentId'] || existingEntity?.parentId)
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [SUBTASK_ID],
          entities: {
            [SUBTASK_ID]: createMockTask({
              id: SUBTASK_ID,
              parentId: PARENT_TASK, // Has parent in existing state
              projectId: undefined,
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_A],
          entities: {
            [PROJECT_A]: createMockProject({ id: PROJECT_A, taskIds: [] }),
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        // Note: parentId not included in LWW update payload
        projectId: PROJECT_A,
        title: 'Subtask moved to project',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;

      // Should still be treated as subtask because existingEntity has parentId
      // Therefore NOT added to project.taskIds
      expect(projectA.taskIds).not.toContain(SUBTASK_ID);
    });
  });

  describe('project.taskIds ordering', () => {
    const PROJECT_A = 'project-a';

    it('should preserve project.taskIds order when adding task', () => {
      const existingTasks = ['task-a', 'task-b', 'task-c'];
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ projectId: undefined }), // Moving to project A
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_A],
          entities: {
            [PROJECT_A]: createMockProject({
              id: PROJECT_A,
              taskIds: existingTasks,
            }),
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_A,
        title: 'Task moving to project',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;

      // Original order should be preserved, new task appended at end
      expect(projectA.taskIds).toEqual([...existingTasks, TASK_ID]);
    });

    it('should preserve project.taskIds order when removing task', () => {
      const PROJECT_B = 'project-b';
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ projectId: PROJECT_A }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [PROJECT_A, PROJECT_B],
          entities: {
            [PROJECT_A]: createMockProject({
              id: PROJECT_A,
              taskIds: ['first', TASK_ID, 'last'],
            }),
            [PROJECT_B]: createMockProject({ id: PROJECT_B, taskIds: [] }),
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        projectId: PROJECT_B, // Moving to different project
        title: 'Task moving between projects',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const projectA = updatedState[PROJECT_FEATURE_NAME]?.entities[PROJECT_A] as Project;

      // Order should be preserved after removal
      expect(projectA.taskIds).toEqual(['first', 'last']);
    });
  });

  describe('TODAY_TAG.taskIds sync on task dueDay change', () => {
    const TODAY_STR = '2025-12-31';
    const TOMORROW_STR = '2026-01-01';
    const YESTERDAY_STR = '2025-12-30';

    beforeEach(() => {
      // Mock date to control what getDbDateStr returns
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date('2025-12-31T12:00:00'));
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    const createStateWithTodayTag = (
      taskDueDay: string | undefined,
      todayTagTaskIds: string[],
    ): Partial<RootState> =>
      ({
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ dueDay: taskDueDay }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: createMockTag({
              id: TODAY_TAG.id,
              title: TODAY_TAG.title,
              taskIds: todayTagTaskIds,
            }),
          },
        },
      }) as Partial<RootState>;

    it('should add task to TODAY_TAG.taskIds when LWW Update recreates task with dueDay = today', () => {
      // Task was deleted locally but UPDATE wins with dueDay = today
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [], // Task doesn't exist
          entities: {},
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: createMockTag({
              id: TODAY_TAG.id,
              title: TODAY_TAG.title,
              taskIds: [],
            }),
          },
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        title: 'Recreated Task',
        dueDay: TODAY_STR,
        tagIds: [],
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      spyOn(OpLog, 'log');
      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      expect(todayTag.taskIds).toContain(TASK_ID);
    });

    it('should add task to TODAY_TAG.taskIds when LWW Update changes dueDay to today', () => {
      // Task has dueDay = tomorrow, LWW update changes it to today
      const state = createStateWithTodayTag(TOMORROW_STR, []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TODAY_STR,
        tagIds: [],
        title: 'Task moved to today',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      expect(todayTag.taskIds).toContain(TASK_ID);
    });

    it('should remove task from TODAY_TAG.taskIds when LWW Update changes dueDay from today', () => {
      // Task has dueDay = today, LWW update changes it to tomorrow
      const state = createStateWithTodayTag(TODAY_STR, [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TOMORROW_STR,
        tagIds: [],
        title: 'Task moved to tomorrow',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      expect(todayTag.taskIds).not.toContain(TASK_ID);
    });

    it('should not modify TODAY_TAG.taskIds when dueDay unchanged (both today)', () => {
      const state = createStateWithTodayTag(TODAY_STR, [TASK_ID, 'other-task']);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TODAY_STR, // Same as before
        tagIds: [],
        title: 'Updated title only',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      // Should preserve order and not duplicate
      expect(todayTag.taskIds).toEqual([TASK_ID, 'other-task']);
    });

    it('should not modify TODAY_TAG.taskIds when dueDay unchanged (neither today)', () => {
      const state = createStateWithTodayTag(YESTERDAY_STR, ['other-task']);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TOMORROW_STR, // Neither old nor new is today
        tagIds: [],
        title: 'Updated task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      expect(todayTag.taskIds).toEqual(['other-task']);
      expect(todayTag.taskIds).not.toContain(TASK_ID);
    });

    it('should handle missing TODAY_TAG gracefully', () => {
      // TODAY_TAG doesn't exist in state
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({ dueDay: TOMORROW_STR }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TODAY_STR,
        tagIds: [],
        title: 'Task moved to today',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      // Should not throw
      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      // State should still be updated without TODAY_TAG changes
      const task = updatedState[TASK_FEATURE_NAME]?.entities[TASK_ID] as Task;
      expect(task.dueDay).toBe(TODAY_STR);
    });

    it('should not duplicate task in TODAY_TAG.taskIds if already present', () => {
      // Task already in TODAY_TAG.taskIds (edge case)
      const state = createStateWithTodayTag(TOMORROW_STR, [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TODAY_STR,
        tagIds: [],
        title: 'Task moved to today',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      // Should still only have one instance
      expect(todayTag.taskIds.filter((id) => id === TASK_ID).length).toBe(1);
    });

    it('should preserve TODAY_TAG.taskIds order when adding task', () => {
      const existingTasks = ['existing-1', 'existing-2'];
      const state = {
        ...createStateWithTodayTag(TOMORROW_STR, existingTasks),
        [TAG_FEATURE_NAME]: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: createMockTag({
              id: TODAY_TAG.id,
              title: TODAY_TAG.title,
              taskIds: existingTasks,
            }),
          },
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TODAY_STR,
        tagIds: [],
        title: 'Task moved to today',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      // Original order should be preserved, new task appended at end
      expect(todayTag.taskIds).toEqual([...existingTasks, TASK_ID]);
    });

    it('should preserve TODAY_TAG.taskIds order when removing task', () => {
      const state = {
        ...createStateWithTodayTag(TODAY_STR, ['first', TASK_ID, 'last']),
        [TAG_FEATURE_NAME]: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: createMockTag({
              id: TODAY_TAG.id,
              title: TODAY_TAG.title,
              taskIds: ['first', TASK_ID, 'last'],
            }),
          },
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TOMORROW_STR,
        tagIds: [],
        title: 'Task moved away from today',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      // Order should be preserved after removal
      expect(todayTag.taskIds).toEqual(['first', 'last']);
    });

    it('should add task to TODAY_TAG.taskIds when dueDay changes from undefined to today', () => {
      const state = createStateWithTodayTag(undefined, []);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: TODAY_STR,
        tagIds: [],
        title: 'Task scheduled for today',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      expect(todayTag.taskIds).toContain(TASK_ID);
    });

    it('should remove task from TODAY_TAG.taskIds when dueDay changes from today to undefined', () => {
      const state = createStateWithTodayTag(TODAY_STR, [TASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: TASK_ID,
        dueDay: undefined,
        tagIds: [],
        title: 'Task unscheduled',
        meta: { isPersistent: true, entityType: 'TASK', entityId: TASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const todayTag = updatedState[TAG_FEATURE_NAME]?.entities[TODAY_TAG.id] as Tag;

      expect(todayTag.taskIds).not.toContain(TASK_ID);
    });
  });

  describe('parent.subTaskIds sync on task parentId change', () => {
    const PARENT_A = 'parent-a';
    const PARENT_B = 'parent-b';
    const SUBTASK_ID = 'subtask-1';

    const createStateWithParents = (
      subtaskParentId: string | undefined,
      parentASubTaskIds: string[],
      parentBSubTaskIds: string[],
    ): Partial<RootState> =>
      ({
        [TASK_FEATURE_NAME]: {
          ids: [SUBTASK_ID, PARENT_A, PARENT_B],
          entities: {
            [SUBTASK_ID]: createMockTask({
              id: SUBTASK_ID,
              parentId: subtaskParentId,
              subTaskIds: [],
            }),
            [PARENT_A]: createMockTask({
              id: PARENT_A,
              parentId: undefined,
              subTaskIds: parentASubTaskIds,
            }),
            [PARENT_B]: createMockTask({
              id: PARENT_B,
              parentId: undefined,
              subTaskIds: parentBSubTaskIds,
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      }) as Partial<RootState>;

    it('should move subtask from old parent to new parent when parentId changes', () => {
      // Subtask is under Parent A, LWW update moves it to Parent B
      const state = createStateWithParents(PARENT_A, [SUBTASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: PARENT_B,
        title: 'Updated Subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentA = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_A] as Task;
      const parentB = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_B] as Task;

      expect(parentA.subTaskIds).not.toContain(SUBTASK_ID);
      expect(parentB.subTaskIds).toContain(SUBTASK_ID);
    });

    it('should add subtask to parent.subTaskIds when task becomes subtask', () => {
      // Task is top-level, LWW update makes it a subtask of Parent A
      const state = createStateWithParents(undefined, [], []);
      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: PARENT_A,
        title: 'Now a subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentA = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_A] as Task;

      expect(parentA.subTaskIds).toContain(SUBTASK_ID);
    });

    it('should remove subtask from parent.subTaskIds when parentId is removed', () => {
      // Subtask is under Parent A, LWW update makes it a top-level task
      const state = createStateWithParents(PARENT_A, [SUBTASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: null,
        title: 'Now a top-level task',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentA = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_A] as Task;

      expect(parentA.subTaskIds).not.toContain(SUBTASK_ID);
    });

    it('should not duplicate subtask in parent.subTaskIds if already present', () => {
      // Subtask already in Parent B's subTaskIds (edge case)
      const state = createStateWithParents(PARENT_A, [SUBTASK_ID], [SUBTASK_ID]);
      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: PARENT_B,
        title: 'Updated Subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentB = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_B] as Task;

      // Should still only have one instance
      expect(parentB.subTaskIds.filter((id) => id === SUBTASK_ID).length).toBe(1);
    });

    it('should not update parent.subTaskIds when parentId does not change', () => {
      const state = createStateWithParents(PARENT_A, [SUBTASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: PARENT_A, // Same as existing
        title: 'Updated Title Only',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentA = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_A] as Task;
      const parentB = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_B] as Task;

      // Parent A should still have the subtask
      expect(parentA.subTaskIds).toContain(SUBTASK_ID);
      // Parent B should still be empty
      expect(parentB.subTaskIds).not.toContain(SUBTASK_ID);
    });

    it('should handle parentId change when old parent does not exist', () => {
      // Old parent was deleted, new parent exists
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [SUBTASK_ID, PARENT_B],
          entities: {
            [SUBTASK_ID]: createMockTask({
              id: SUBTASK_ID,
              parentId: 'deleted-parent',
              subTaskIds: [],
            }),
            [PARENT_B]: createMockTask({
              id: PARENT_B,
              parentId: undefined,
              subTaskIds: [],
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: PARENT_B,
        title: 'Updated Subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      // Should not throw
      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentB = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_B] as Task;

      expect(parentB.subTaskIds).toContain(SUBTASK_ID);
    });

    it('should handle parentId change when new parent does not exist', () => {
      // New parent doesn't exist (edge case)
      const state = createStateWithParents(PARENT_A, [SUBTASK_ID], []);
      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: 'non-existent-parent',
        title: 'Updated Subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      // Should not throw
      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentA = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_A] as Task;

      // Old parent should have subtask removed
      expect(parentA.subTaskIds).not.toContain(SUBTASK_ID);
    });

    it('should preserve parent.subTaskIds order when adding subtask', () => {
      const existingSubtasks = ['sub-a', 'sub-b', 'sub-c'];
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [SUBTASK_ID, PARENT_A],
          entities: {
            [SUBTASK_ID]: createMockTask({
              id: SUBTASK_ID,
              parentId: undefined,
              subTaskIds: [],
            }),
            [PARENT_A]: createMockTask({
              id: PARENT_A,
              parentId: undefined,
              subTaskIds: existingSubtasks,
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: PARENT_A,
        title: 'Becoming a subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentA = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_A] as Task;

      // Original order should be preserved, new subtask appended at end
      expect(parentA.subTaskIds).toEqual([...existingSubtasks, SUBTASK_ID]);
    });

    it('should preserve parent.subTaskIds order when removing subtask', () => {
      const state = {
        [TASK_FEATURE_NAME]: {
          ids: [SUBTASK_ID, PARENT_A],
          entities: {
            [SUBTASK_ID]: createMockTask({
              id: SUBTASK_ID,
              parentId: PARENT_A,
              subTaskIds: [],
            }),
            [PARENT_A]: createMockTask({
              id: PARENT_A,
              parentId: undefined,
              subTaskIds: ['first', SUBTASK_ID, 'last'],
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
        [PROJECT_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
        [TAG_FEATURE_NAME]: {
          ids: [],
          entities: {},
        },
      } as Partial<RootState>;

      const action = {
        type: '[TASK] LWW Update',
        id: SUBTASK_ID,
        parentId: null, // Becoming top-level
        title: 'No longer a subtask',
        meta: { isPersistent: true, entityType: 'TASK', entityId: SUBTASK_ID },
      };

      reducer(state, action);

      const updatedState = mockReducer.calls.mostRecent().args[0] as Partial<RootState>;
      const parentA = updatedState[TASK_FEATURE_NAME]?.entities[PARENT_A] as Task;

      // Order should be preserved after removal
      expect(parentA.subTaskIds).toEqual(['first', 'last']);
    });
  });
});
