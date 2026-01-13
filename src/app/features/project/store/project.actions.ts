import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Project } from '../project.model';
import { WorkContextAdvancedCfgKey } from '../../work-context/work-context.model';
import { DropListModelSource } from '../../tasks/task.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const loadProjects = createAction(
  '[Project] Load Projects',
  props<{ projects: Project[] }>(),
);

export const addProject = createAction(
  '[Project] Add Project',
  (projectProps: { project: Project }) => ({
    ...projectProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityId: projectProps.project.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const addProjects = createAction(
  '[Project] Add Projects',
  props<{ projects: Project[] }>(),
);

export const updateProject = createAction(
  '[Project] Update Project',
  (projectProps: { project: Update<Project> }) => ({
    ...projectProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityId: projectProps.project.id as string,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const updateProjectAdvancedCfg = createAction(
  '[Project] Update Project Advanced Cfg',
  (projectProps: {
    projectId: string;
    sectionKey: WorkContextAdvancedCfgKey;
    data: any;
  }) => ({
    ...projectProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityId: projectProps.projectId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const updateProjectOrder = createAction(
  '[Project] Update Project Order',
  (projectProps: { ids: string[] }) => ({
    ...projectProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityIds: projectProps.ids,
      opType: OpType.Move,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const archiveProject = createAction(
  '[Project] Archive Project',
  (projectProps: { id: string }) => ({
    ...projectProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityId: projectProps.id,
      opType: OpType.Update, // Archiving is an update
    } satisfies PersistentActionMeta,
  }),
);

export const unarchiveProject = createAction(
  '[Project] Unarchive Project',
  (projectProps: { id: string }) => ({
    ...projectProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityId: projectProps.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const toggleHideFromMenu = createAction(
  '[Project] Toggle hide from menu',
  (projectProps: { id: string }) => ({
    ...projectProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityId: projectProps.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

// MOVE TASK ACTIONS
// -----------------
export const moveProjectTaskToBacklogListAuto = createAction(
  '[Project] Auto Move Task from regular to backlog',
  (taskProps: { taskId: string; projectId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskToRegularListAuto = createAction(
  '[Project] Auto Move Task from backlog to regular',
  (taskProps: { taskId: string; projectId: string; isMoveToTop: boolean }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskUpInBacklogList = createAction(
  '[Project] Move Task Up in Backlog',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneBacklogTaskIds: string[];
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskDownInBacklogList = createAction(
  '[Project] Move Task Down in Backlog',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneBacklogTaskIds: string[];
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskToTopInBacklogList = createAction(
  '[Project] Move Task to Top in Backlog',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneBacklogTaskIds: string[];
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskToBottomInBacklogList = createAction(
  '[Project] Move Task to Bottom in Backlog',
  (taskProps: {
    taskId: string;
    workContextId: string;
    doneBacklogTaskIds: string[];
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskInBacklogList = createAction(
  '[Project] Move Task in Backlog',
  (taskProps: { taskId: string; afterTaskId: string | null; workContextId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskToBacklogList = createAction(
  '[Project] Move Task from regular to backlog',
  (taskProps: { taskId: string; afterTaskId: string | null; workContextId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveProjectTaskToRegularList = createAction(
  '[Project] Move Task from backlog to regular',
  (taskProps: {
    taskId: string;
    afterTaskId: string | null;
    workContextId: string;
    src: DropListModelSource;
    target: DropListModelSource;
  }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: taskProps.taskId,
      opType: OpType.Move,
    } satisfies PersistentActionMeta,
  }),
);

export const moveAllProjectBacklogTasksToRegularList = createAction(
  '[Project] Move all backlog tasks to regular',
  (taskProps: { projectId: string }) => ({
    ...taskProps,
    meta: {
      isPersistent: true,
      entityType: 'PROJECT',
      entityId: taskProps.projectId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
