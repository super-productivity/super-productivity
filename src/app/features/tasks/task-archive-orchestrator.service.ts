import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { first } from 'rxjs/operators';
import { Task, TaskArchive, TaskWithSubTasks } from './task.model';
import { TaskService } from './task.service';
import { RootState } from '../../root-store/root-state';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { ArchiveService } from '../archive/archive.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskLog } from '../../core/log';
import { devError } from '../../util/dev-error';

/**
 * Archive moves and store+archive lookups for tasks; persists the archive
 * before dispatching `moveToArchive`.
 */
@Injectable({
  providedIn: 'root',
})
export class TaskArchiveOrchestratorService {
  private readonly _store = inject<Store<RootState>>(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _archiveService = inject(ArchiveService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _archiveTaskPromisesById = new Map<string, Promise<void>>();

  async moveToArchive(tasks: TaskWithSubTasks | TaskWithSubTasks[]): Promise<void> {
    if (!tasks) {
      TaskLog.err(
        '[TaskArchiveOrchestrator] moveToArchive called with null/undefined tasks',
      );
      return;
    }

    if (!Array.isArray(tasks)) {
      TaskLog.warn(
        '[TaskArchiveOrchestrator] moveToArchive converting single task to array',
        {
          id: tasks.id,
        },
      );
      tasks = [tasks];
    }

    if (!tasks.length) {
      TaskLog.log('[TaskArchiveOrchestrator] No tasks to archive');
      return;
    }

    TaskLog.log('[TaskArchiveOrchestrator] moveToArchive called with:', {
      count: tasks.length,
      taskIds: tasks.map((t) => t?.id),
      tasksType: typeof tasks,
      isArray: Array.isArray(tasks),
    });

    // NOTE: malformed tasks (missing/invalid ids) are dropped inside archive.service
    // via sanitizeTasksForArchiving, which also covers writeTasksToArchiveForRemoteSync.
    // We only update real parents here since otherwise we'd move sub-tasks without
    // their parent into the archive.
    const subTasks = tasks.filter((t) => t?.parentId);
    const parentTasks = tasks.filter((t) => t && !t.parentId);

    TaskLog.log('[TaskArchiveOrchestrator] Filtered tasks:', {
      parentTasks: parentTasks.map((t) => t.id),
      subTasks: subTasks.map((t) => t.id),
    });

    if (subTasks.length) {
      if (this._workContextService.activeWorkContextType !== WorkContextType.TAG) {
        // this should be handled by moving parentTasks to archive
        devError('Trying to move sub tasks into archive for project');
      } else {
        // when on a tag such as today, we simply remove the tag instead of attempting to move to archive
        const tagId = this._workContextService.activeWorkContextId;
        TaskLog.log('[TaskArchiveOrchestrator] Removing tag from subtasks:', tagId);
        subTasks.forEach((st) => {
          this._taskService.updateTags(
            st,
            st.tagIds.filter((tid) => tid !== tagId),
          );
        });
      }
    }

    const parentTasksToArchive: TaskWithSubTasks[] = [];
    const reservedTaskIds = new Set<string>();
    const existingArchivePromises = new Set<Promise<void>>();
    for (const task of parentTasks) {
      if (task.id) {
        const existingArchivePromise = this._archiveTaskPromisesById.get(task.id);
        if (existingArchivePromise) {
          TaskLog.log('[TaskArchiveOrchestrator] Archive already in progress', {
            id: task.id,
          });
          existingArchivePromises.add(existingArchivePromise);
          continue;
        }
        if (reservedTaskIds.has(task.id)) {
          continue;
        }
        reservedTaskIds.add(task.id);
      }
      parentTasksToArchive.push(task);
    }

    if (parentTasksToArchive.length) {
      // Only move parent tasks to archive, never subtasks
      // Note: Full task payload required for sync - see docs/sync-and-op-log/operation-log-architecture.md
      // Persist first: dispatch removes the tasks from NgRx and makes the captured
      // operation eligible for a full-state snapshot. If archive persistence were
      // still in flight, that snapshot could acknowledge the operation while
      // omitting its archived task data.
      const archivePromise = (async (): Promise<void> => {
        TaskLog.log('[TaskArchiveOrchestrator] Calling archive service to persist tasks');
        await this._archiveService.moveTasksToArchiveAndFlushArchiveIfDue(
          parentTasksToArchive,
        );
        TaskLog.log(
          '[TaskArchiveOrchestrator] Dispatching moveToArchive action for parent tasks',
        );
        this._store.dispatch(
          TaskSharedActions.moveToArchive({ tasks: parentTasksToArchive }),
        );
        TaskLog.log('[TaskArchiveOrchestrator] Archive operation completed successfully');
      })();
      for (const taskId of reservedTaskIds) {
        this._archiveTaskPromisesById.set(taskId, archivePromise);
      }

      try {
        await Promise.all([...existingArchivePromises, archivePromise]);
      } finally {
        for (const taskId of reservedTaskIds) {
          if (this._archiveTaskPromisesById.get(taskId) === archivePromise) {
            this._archiveTaskPromisesById.delete(taskId);
          }
        }
      }
    } else if (existingArchivePromises.size > 0) {
      // A duplicate caller observes the same success/failure and does not return
      // before the durable archive write plus NgRx removal have completed.
      await Promise.all(existingArchivePromises);
    } else {
      TaskLog.log('[TaskArchiveOrchestrator] No parent tasks to archive');
    }
  }

  restoreTask(task: Task, subTasks: Task[]): void {
    this._store.dispatch(TaskSharedActions.restoreTask({ task, subTasks }));
  }

  // BEWARE: does only work for task model updates, but not for related models
  async updateEverywhere(id: string, changedFields: Partial<Task>): Promise<void> {
    const state = await this._taskService.taskFeatureState$.pipe(first()).toPromise();
    const { entities } = state;
    if (entities[id]) {
      this._taskService.update(id, changedFields);
    } else {
      await this.updateArchiveTask(id, changedFields);
    }
  }

  // TODO remove in favor of calling this directly
  // BEWARE: does only work for task model updates, but not the meta models
  async updateArchiveTask(id: string, changedFields: Partial<Task>): Promise<void> {
    return this._taskArchiveService.updateTask(id, changedFields);
  }

  // BEWARE: does only work for task model updates, but not the meta models
  async updateArchiveTasks(updates: Update<Task>[]): Promise<void> {
    return this._taskArchiveService.updateTasks(updates);
  }

  async getByIdFromEverywhere(id: string, isArchive?: boolean): Promise<Task> {
    if (isArchive === undefined) {
      const task = await this._taskService.getByIdOnce$(id).toPromise();
      if (task) {
        return task;
      }
      return await this._taskArchiveService.getById(id);
    }

    if (isArchive) {
      return await this._taskArchiveService.getById(id);
    } else {
      return await this._taskService.getByIdOnce$(id).toPromise();
    }
  }

  async getAllTasksForProject(projectId: string): Promise<Task[]> {
    const allTasks = await this._taskService.allTasks$.pipe(first()).toPromise();
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    const archiveTasks = ids
      .map((id) => archiveTaskState.entities[id])
      .filter((task): task is Task => !!task);
    return [...allTasks, ...archiveTasks].filter((task) => task.projectId === projectId);
  }

  async getArchiveTasksForRepeatCfgId(repeatCfgId: string): Promise<Task[]> {
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    const archiveTasks = ids
      .map((id) => archiveTaskState.entities[id])
      .filter((task): task is Task => !!task);
    return archiveTasks.filter((task) => task.repeatCfgId === repeatCfgId);
  }

  async getArchivedTasks(): Promise<Task[]> {
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    return ids
      .map((id) => archiveTaskState.entities[id])
      .filter((task): task is Task => !!task);
  }

  async getAllIssueIdsForProviderEverywhere(issueProviderId: string): Promise<string[]> {
    const allTasks = await this.getAllTasksEverywhere();
    return allTasks
      .filter((task) => task.issueProviderId === issueProviderId)
      .map((task) => task.issueId) as string[];
  }

  async getAllTasksEverywhere(): Promise<Task[]> {
    const allTasks = await this._taskService.allTasks$.pipe(first()).toPromise();
    const archiveTaskState: TaskArchive = await this._taskArchiveService.load();
    const ids = (archiveTaskState && (archiveTaskState.ids as string[])) || [];
    const archiveTasks = ids
      .map((id) => archiveTaskState.entities[id])
      .filter((task): task is Task => !!task);
    return [...allTasks, ...archiveTasks] as Task[];
  }
}
