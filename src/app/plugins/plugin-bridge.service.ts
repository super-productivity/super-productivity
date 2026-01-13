import { inject, Injectable, Injector, OnDestroy, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { SnackService } from '../core/snack/snack.service';
import { NotifyService } from '../core/notify/notify.service';
import {
  DialogCfg,
  Hooks,
  NotifyCfg,
  PluginCreateTaskData,
  PluginHeaderBtnCfg,
  PluginHookHandler,
  PluginMenuEntryCfg,
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
  PluginShortcutCfg,
  PluginSidePanelBtnCfg,
  Task,
} from './plugin-api.model';

import {
  BatchTaskCreate,
  BatchUpdateRequest,
  BatchUpdateResult,
  PluginManifest,
  SnackCfg,
} from '@super-productivity/plugin-api';
import { snackCfgToSnackParams } from './plugin-api-mapper';
import { PluginHooksService } from './plugin-hooks';
import { TaskService } from '../features/tasks/task.service';
import { addSubTask } from '../features/tasks/store/task.actions';
import { TaskSharedActions } from '../root-store/meta/task-shared.actions';
import { nanoid } from 'nanoid';
import { WorkContextService } from '../features/work-context/work-context.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import typia from 'typia';
import { first, take, map } from 'rxjs/operators';
import { selectTaskByIdWithSubTaskData } from '../features/tasks/store/task.selectors';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginConfigService } from './plugin-config.service';
import { TaskArchiveService } from '../features/archive/task-archive.service';
import { Router } from '@angular/router';
import { PluginDialogComponent } from './ui/plugin-dialog/plugin-dialog.component';
import { IS_ELECTRON } from '../app.constants';
import { isAllowedPluginAction } from './allowed-plugin-actions.const';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../t.const';
import { SyncWrapperService } from '../imex/sync/sync-wrapper.service';
import { Log, PluginLog } from '../core/log';
import { TaskCopy } from '../features/tasks/task.model';
import { ProjectCopy } from '../features/project/project.model';
import { TagCopy } from '../features/tag/tag.model';
import { MAX_BATCH_OPERATIONS_SIZE } from '../op-log/core/operation-log.const';

// New imports for simple counters
import { selectAllSimpleCounters } from '../features/simple-counter/store/simple-counter.reducer';
import {
  SimpleCounter,
  SimpleCounterType,
} from '../features/simple-counter/simple-counter.model';
import { EMPTY_SIMPLE_COUNTER } from '../features/simple-counter/simple-counter.const';
import {
  upsertSimpleCounter,
  updateSimpleCounter,
  deleteSimpleCounter,
  toggleSimpleCounterCounter,
} from '../features/simple-counter/store/simple-counter.actions';

/**
 * PluginBridge acts as an intermediary layer between plugins and the main application services.
 * This provides:
 * - Clean separation of concerns
 * - Controlled access to app functionality
 * - Easy testing and mocking
 * - Centralized plugin-to-app communication
 */
@Injectable({
  providedIn: 'root',
})
export class PluginBridgeService implements OnDestroy {
  private _snackService = inject(SnackService);
  private _notifyService = inject(NotifyService);
  private _dialog = inject(MatDialog);
  private _store = inject(Store);
  private _pluginHooksService = inject(PluginHooksService);
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _pluginUserPersistenceService = inject(PluginUserPersistenceService);
  private _pluginConfigService = inject(PluginConfigService);
  private _taskArchiveService = inject(TaskArchiveService);
  private _router = inject(Router);
  private _injector = inject(Injector);
  private _translateService = inject(TranslateService);
  private _syncWrapperService = inject(SyncWrapperService);

  // Track header buttons registered by plugins
  private readonly _headerButtons = signal<PluginHeaderBtnCfg[]>([]);
  public readonly headerButtons = this._headerButtons.asReadonly();

  // Track menu entries registered by plugins
  private readonly _menuEntries = signal<PluginMenuEntryCfg[]>([]);
  public readonly menuEntries = this._menuEntries.asReadonly();

  // Track shortcuts registered by plugins
  readonly shortcuts = signal<PluginShortcutCfg[]>([]);

  // Track side panel buttons registered by plugins
  private readonly _sidePanelButtons = signal<PluginSidePanelBtnCfg[]>([]);
  public readonly sidePanelButtons = this._sidePanelButtons.asReadonly();

  constructor() {
    // Initialize window focus tracking
    this._initWindowFocusTracking();
  }

  /**
   * Create bound methods for a specific plugin
   * This ensures each plugin has its own set of methods with the pluginId already bound
   */
  createBoundMethods(
    pluginId: string,
    manifest?: PluginManifest,
  ): {
    persistDataSynced: (dataStr: string) => Promise<void>;
    loadPersistedData: () => Promise<string | null>;
    getConfig: () => Promise<any>;
    downloadFile: (filename: string, data: string) => Promise<void>;
    registerHeaderButton: (cfg: PluginHeaderBtnCfg) => void;
    registerMenuEntry: (cfg: Omit<PluginMenuEntryCfg, 'pluginId'>) => void;
    registerSidePanelButton: (cfg: Omit<PluginSidePanelBtnCfg, 'pluginId'>) => void;
    registerShortcut: (cfg: PluginShortcutCfg) => void;
    showIndexHtmlAsView: () => void;
    triggerSync: () => Promise<void>;
    dispatchAction: (action: { type: string; [key: string]: unknown }) => void;
    executeNodeScript: (
      request: PluginNodeScriptRequest,
    ) => Promise<PluginNodeScriptResult>;
    getAllCounters: () => Promise<{ [key: string]: number }>;
    getCounter: (id: string) => Promise<number | null>;
    setCounter: (id: string, value: number) => Promise<void>;
    incrementCounter: (id: string, incrementBy?: number) => Promise<number>;
    decrementCounter: (id: string, decrementBy?: number) => Promise<number>;
    deleteCounter: (id: string) => Promise<void>;
    getAllSimpleCounters: () => Promise<SimpleCounter[]>;
    getSimpleCounter: (id: string) => Promise<SimpleCounter | undefined>;
    updateSimpleCounter: (id: string, updates: Partial<SimpleCounter>) => Promise<void>;
    toggleSimpleCounter: (id: string) => Promise<void>;
    setSimpleCounterEnabled: (id: string, isEnabled: boolean) => Promise<void>;
    deleteSimpleCounter: (id: string) => Promise<void>;
    setSimpleCounterToday: (id: string, value: number) => Promise<void>;
    setSimpleCounterDate: (id: string, date: string, value: number) => Promise<void>;
    log: ReturnType<typeof Log.withContext>;
  } {
    return {
      // Data persistence
      persistDataSynced: (dataStr: string) => this._persistDataSynced(pluginId, dataStr),
      loadPersistedData: () => this._loadPersistedData(pluginId),
      getConfig: () => this._getConfig(pluginId),
      downloadFile: (filename: string, data: string) =>
        this._downloadFile(filename, data),

      // UI registration
      registerHeaderButton: (cfg: PluginHeaderBtnCfg) =>
        this._registerHeaderButton(pluginId, cfg),
      registerMenuEntry: (cfg: Omit<PluginMenuEntryCfg, 'pluginId'>) =>
        this._registerMenuEntry(pluginId, cfg),
      registerSidePanelButton: (cfg: Omit<PluginSidePanelBtnCfg, 'pluginId'>) =>
        this._registerSidePanelButton(pluginId, cfg),
      registerShortcut: (cfg: PluginShortcutCfg) => this._registerShortcut(pluginId, cfg),

      // Navigation
      showIndexHtmlAsView: () => this._showIndexHtmlAsView(pluginId),

      // Sync
      triggerSync: () => this._triggerSync(pluginId),

      // Actions
      dispatchAction: (action: { type: string; [key: string]: unknown }) =>
        this._dispatchAction(pluginId, action),

      // Node execution
      executeNodeScript: (request: PluginNodeScriptRequest) =>
        this._executeNodeScript(pluginId, manifest || null, request),

      // Basic counter methods (existing)
      getAllCounters: () => this.getAllCounters(),
      getCounter: (id: string) => this.getCounter(id),
      setCounter: (id: string, value: number) => this.setCounter(id, value),
      incrementCounter: (id: string, incrementBy = 1) =>
        this.incrementCounter(id, incrementBy),
      decrementCounter: (id: string, decrementBy = 1) =>
        this.decrementCounter(id, decrementBy),
      deleteCounter: (id: string) => this.deleteSimpleCounter(id),

      // Full SimpleCounter methods (new)
      getAllSimpleCounters: () => this.getAllSimpleCounters(),
      getSimpleCounter: (id: string) => this.getSimpleCounter(id),
      updateSimpleCounter: (id: string, updates: Partial<SimpleCounter>) =>
        this.updateSimpleCounter(id, updates),
      toggleSimpleCounter: (id: string) => this.toggleSimpleCounter(id),
      setSimpleCounterEnabled: (id: string, isEnabled: boolean) =>
        this.setSimpleCounterEnabled(id, isEnabled),
      deleteSimpleCounter: (id: string) => this.deleteSimpleCounter(id),
      setSimpleCounterToday: (id: string, value: number) =>
        this.setSimpleCounterToday(id, value),
      setSimpleCounterDate: (id: string, date: string, value: number) =>
        this.setSimpleCounterDate(id, date, value),

      // Logging
      log: Log.withContext(`${pluginId}`),
    };
  }

  /**
   * Internal method to download file
   */
  private async _downloadFile(filename: string, data: string): Promise<void> {
    typia.assert<string>(filename);
    typia.assert<string>(data);

    const { download } = await import('../util/download');
    await download(filename, data);
  }

  /**
   * Show a snack message to the user
   */
  showSnack(snackCfg: SnackCfg): void {
    typia.assert<SnackCfg>(snackCfg);
    const snackParams = snackCfgToSnackParams(snackCfg);
    this._snackService.open(snackParams);
  }

  /**
   * Show a notification to the user
   */
  async notify(notifyCfg: NotifyCfg): Promise<void> {
    typia.assert<NotifyCfg>(notifyCfg);

    // Use the app's NotifyService for better integration
    await this._notifyService.notify({
      title: notifyCfg.title,
      body: notifyCfg.body,
      icon: 'assets/icons/icon-128x128.png',
      duration: 5000, // 5 seconds default duration
    });

    PluginLog.log('PluginBridge: Notification sent successfully', notifyCfg);
  }

  /**
   * Open a dialog using Angular Material
   */
  async openDialog(dialogCfg: DialogCfg): Promise<void> {
    typia.assert<DialogCfg>(dialogCfg);

    return new Promise<void>((resolve, reject) => {
      try {
        const dialogRef = this._dialog.open(PluginDialogComponent, {
          data: dialogCfg,
          // TODO make configurable
          // width: '500px',
          // maxWidth: '90vw',
          // maxHeight: '80vh',
          autoFocus: true,
          restoreFocus: true,
          disableClose: false,
        });

        dialogRef.afterClosed().subscribe((result) => {
          PluginLog.log('PluginBridge: Dialog closed with result:', result);
          resolve();
        });
      } catch (error) {
        PluginLog.err('PluginBridge: Failed to open dialog:', error);
        reject(error);
      }
    });
  }

  /**
   * Internal method to show plugin index.html as view
   */
  private _showIndexHtmlAsView(pluginId: string): void {
    console.log('PluginBridge: Navigating to plugin index view', {
      pluginId,
    });
    // Navigate to the plugin index route
    this._router.navigate(['/plugins', pluginId, 'index']);
  }

  /**
   * Get all tasks
   */
  async getTasks(): Promise<TaskCopy[]> {
    const tasks = await this._taskService.allTasks$.pipe(first()).toPromise();
    return tasks || [];
  }

  /**
   * Get archived tasks
   */
  async getArchivedTasks(): Promise<TaskCopy[]> {
    try {
      const taskArchive = await this._taskArchiveService.load();

      // Convert the archive format to TaskCopy array
      const archivedTasks: TaskCopy[] = taskArchive.ids.map((id) => {
        const task = taskArchive.entities[id];
        if (!task) {
          throw new Error(`Archived task with id ${id} not found in entities`);
        }
        return task as TaskCopy;
      });

      PluginLog.log('PluginBridge: Retrieved archived tasks', {
        count: archivedTasks.length,
      });
      return archivedTasks;
    } catch (error) {
      PluginLog.err('PluginBridge: Failed to load archived tasks:', error);
      return [];
    }
  }

  /**
   * Get current context tasks
   */
  async getCurrentContextTasks(): Promise<TaskCopy[]> {
    const contextTasks = await this._workContextService.mainListTasks$
      .pipe(first())
      .toPromise();
    return contextTasks || [];
  }

  /**
   * Update a task
   */
  async updateTask(taskId: string, updates: Partial<TaskCopy>): Promise<void> {
    typia.assert<string>(taskId);
    typia.assert<Partial<TaskCopy>>(updates);

    // Validate that referenced project, tags, and parent task exist if they are being updated
    await this._validateTaskReferences(
      updates.projectId,
      updates.tagIds,
      updates.parentId,
    );

    // Update the task using TaskService (TaskCopy is compatible with Task)
    this._taskService.update(taskId, updates);

    PluginLog.log('PluginBridge: Task updated successfully', { taskId, updates });
  }

  /**
   * Add a new task
   */
  async addTask(taskData: PluginCreateTaskData): Promise<string> {
    typia.assert<PluginCreateTaskData>(taskData);

    // Validate that referenced project, tags, and parent task exist
    await this._validateTaskReferences(
      taskData.projectId,
      taskData.tagIds,
      taskData.parentId,
    );

    let createdTask: Task;
    if (taskData.parentId) {
      // For subtasks, we need to use the addSubTask action to properly update parent
      const newTask = this._taskService.createNewTaskWithDefaults({
        title: taskData.title,
        additional: {
          notes: taskData.notes || '',
          timeEstimate: taskData.timeEstimate || 0,
          isDone: (taskData as { isDone?: boolean }).isDone || false,
          tagIds: [], // Subtasks don't have tags
          projectId: taskData.projectId || undefined,
        },
      });

      // Dispatch the addSubTask action which properly updates parent's subTaskIds
      this._store.dispatch(
        addSubTask({
          task: newTask,
          parentId: taskData.parentId,
        }),
      );
      createdTask = newTask;

      PluginLog.log('PluginBridge: Subtask added successfully', {
        taskId: createdTask.id,
        taskData,
      });

      return createdTask.id;
    } else {
      // For main tasks, use the regular add method
      const additional: Partial<TaskCopy> = {
        projectId: taskData.projectId || undefined,
        tagIds: taskData.tagIds || [],
        notes: taskData.notes || '',
        timeEstimate: taskData.timeEstimate || 0,
        isDone: (taskData as { isDone?: boolean }).isDone || false,
      };

      // Add the task using TaskService
      const taskId = this._taskService.add(
        taskData.title,
        false, // isAddToBacklog
        additional,
        false, // isAddToBottom
      );

      PluginLog.log('PluginBridge: Task added successfully', { taskId, taskData });
      return taskId;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    typia.assert<string>(taskId);

    try {
      // Get the task with its subtasks
      const taskWithSubTasks = await this._store
        .select(selectTaskByIdWithSubTaskData, { id: taskId })
        .pipe(first())
        .toPromise();

      if (!taskWithSubTasks) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.TASK_NOT_FOUND, { taskId }),
        );
      }

      // Use the TaskService remove method which handles deletion properly
      this._taskService.remove(taskWithSubTasks);

      console.log('PluginBridge: Task deleted successfully', {
        taskId,
        hadSubTasks: taskWithSubTasks.subTasks.length > 0,
      });
    } catch (error) {
      console.error('PluginBridge: Failed to delete task:', error);
      throw error;
    }
  }

  /**
   * Get all projects
   */
  async getAllProjects(): Promise<ProjectCopy[]> {
    const projects = await this._projectService.list$.pipe(first()).toPromise();
    return projects || [];
  }

  /**
   * Add a new project
   */
  async addProject(projectData: Partial<ProjectCopy>): Promise<string> {
    typia.assert<Partial<ProjectCopy>>(projectData);

    PluginLog.log('PluginBridge: Project add', { projectData });
    return this._projectService.add(projectData);
  }

  /**
   * Update a project
   */
  async updateProject(projectId: string, updates: Partial<ProjectCopy>): Promise<void> {
    typia.assert<string>(projectId);
    typia.assert<Partial<ProjectCopy>>(updates);

    // Update the project using ProjectService (ProjectCopy is compatible with Project)
    this._projectService.update(projectId, updates);

    PluginLog.log('PluginBridge: Project updated successfully', { projectId, updates });
  }

  /**
   * Get all tags
   */
  async getAllTags(): Promise<TagCopy[]> {
    const tags = await this._tagService.tags$.pipe(first()).toPromise();
    return tags || [];
  }

  /**
   * Add a new tag
   */
  async addTag(tagData: Partial<TagCopy>): Promise<string> {
    typia.assert<Partial<TagCopy>>(tagData);

    // Add the tag using TagService (TagCopy is compatible with Tag)
    const tagId = this._tagService.addTag(tagData);
    PluginLog.log('PluginBridge: Tag added successfully', { tagId, tagData });
    return tagId;
  }

  /**
   * Update a tag
   */
  async updateTag(tagId: string, updates: Partial<TagCopy>): Promise<void> {
    typia.assert<string>(tagId);
    typia.assert<Partial<TagCopy>>(updates);

    // Update the tag using TagService (TagCopy is compatible with Tag)
    this._tagService.updateTag(tagId, updates);
    PluginLog.log('PluginBridge: Tag updated successfully', { tagId, updates });
  }

  /**
   * Reorder tasks in a project or parent task
   * @param taskIds - Array of task IDs in the new order
   * @param contextId - Project ID or parent task ID
   * @param contextType - 'project' or 'task' to indicate if contextId is a project or parent task
   */
  async reorderTasks(
    taskIds: string[],
    contextId: string,
    contextType: 'project' | 'task',
  ): Promise<void> {
    typia.assert<string[]>(taskIds);
    typia.assert<string>(contextId);
    typia.assert<'project' | 'task'>(contextType);

    if (contextType === 'project') {
      // Update project's taskIds to reflect new order
      const project = await this._projectService
        .getByIdOnce$(contextId)
        .pipe(first())
        .toPromise();

      if (!project) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.PROJECT_NOT_FOUND, { contextId }),
        );
      }

      // Validate all taskIds belong to the project
      const allProjectTaskIds = [
        ...(project.taskIds || []),
        ...(project.backlogTaskIds || []),
      ];

      // Also check if tasks actually belong to this project by their projectId
      const allTasks = await this._taskService.allTasks$.pipe(first()).toPromise();
      const tasksInProject =
        allTasks?.filter((t) => t.projectId === contextId && !t.parentId) || [];
      const taskIdsInProject = tasksInProject.map((t) => t.id);

      PluginLog.log('PluginBridge: Validating task reorder', {
        requestedTaskIds: taskIds,
        projectTaskIds: allProjectTaskIds,
        actualTasksInProject: taskIdsInProject,
        projectId: contextId,
      });

      // Use a more lenient validation - check if tasks have the correct projectId
      const invalidTaskIds = taskIds.filter((id) => {
        const task = allTasks?.find((t) => t.id === id);
        return !task || task.projectId !== contextId || task.parentId;
      });

      if (invalidTaskIds.length > 0) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.TASKS_NOT_IN_PROJECT, {
            taskIds: invalidTaskIds.join(', '),
            contextId,
          }),
        );
      }

      // Update the project with new task order
      // Note: This assumes all tasks are in the regular list, not backlog
      this._projectService.update(contextId, { taskIds });

      PluginLog.log('PluginBridge: Project tasks reordered successfully', {
        projectId: contextId,
        newOrder: taskIds,
      });
    } else {
      // Update parent task's subTaskIds to reflect new order
      const parentTask = await this._taskService
        .getByIdOnce$(contextId)
        .pipe(first())
        .toPromise();

      if (!parentTask) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.PARENT_TASK_NOT_FOUND, { contextId }),
        );
      }

      // Validate all taskIds are subtasks of the parent
      const invalidSubTaskIds = taskIds.filter(
        (id) => !parentTask.subTaskIds.includes(id),
      );

      if (invalidSubTaskIds.length > 0) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.TASKS_NOT_SUBTASKS, {
            taskIds: invalidSubTaskIds.join(', '),
            contextId,
          }),
        );
      }

      // Update the task with new subtask order
      this._taskService.update(contextId, { subTaskIds: taskIds });

      PluginLog.log('PluginBridge: Subtasks reordered successfully', {
        parentTaskId: contextId,
        newOrder: taskIds,
      });
    }
  }

  /**
   * Batch update tasks for a project
   * Only generate IDs here - let the reducer handle all validation
   * Large batches are automatically chunked to prevent oversized operation payloads
   */
  async batchUpdateForProject(request: BatchUpdateRequest): Promise<BatchUpdateResult> {
    typia.assert<BatchUpdateRequest>(request);

    // Generate IDs for all create operations upfront
    // We need consistent IDs across all chunks
    const createdTaskIds: { [tempId: string]: string } = {};
    request.operations.forEach((op) => {
      if (op.type === 'create') {
        const createOp = op as BatchTaskCreate;
        createdTaskIds[createOp.tempId] = nanoid();
      }
    });

    // Chunk large operations to prevent oversized payloads
    const chunks = this._chunkOperations(request.operations);

    if (chunks.length > 1) {
      PluginLog.log('PluginBridge: Chunking large batch operation', {
        totalOperations: request.operations.length,
        chunks: chunks.length,
        chunkSize: MAX_BATCH_OPERATIONS_SIZE,
      });
    }

    // Dispatch each chunk as a separate action
    chunks.forEach((chunk) => {
      this._store.dispatch(
        TaskSharedActions.batchUpdateForProject({
          projectId: request.projectId,
          operations: chunk,
          createdTaskIds, // Same IDs mapping for all chunks
        }),
      );
    });

    // Return the generated IDs immediately
    // The reducer will validate everything including project existence
    return {
      success: true,
      createdTaskIds,
    };
  }

  /**
   * Chunks operations array into smaller batches to prevent oversized payloads
   */
  private _chunkOperations<T>(operations: T[]): T[][] {
    if (operations.length <= MAX_BATCH_OPERATIONS_SIZE) {
      return [operations];
    }

    const chunks: T[][] = [];
    for (let i = 0; i < operations.length; i += MAX_BATCH_OPERATIONS_SIZE) {
      chunks.push(operations.slice(i, i + MAX_BATCH_OPERATIONS_SIZE));
    }
    return chunks;
  }

  /**
   * Internal method to persist plugin data
   * Includes size and rate limit validation
   */
  private async _persistDataSynced(pluginId: string, dataStr: string): Promise<void> {
    typia.assert<string>(dataStr);

    try {
      this._pluginUserPersistenceService.persistPluginUserData(pluginId, dataStr);
      console.log('PluginBridge: Plugin data persisted successfully', {
        pluginId,
        dataSize: new Blob([dataStr]).size,
      });
    } catch (error) {
      // Log the specific error (rate limit or size exceeded)
      PluginLog.err('PluginBridge: Failed to persist plugin data:', error);

      // Rethrow with the original error message for better debugging
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(this._translateService.instant(T.PLUGINS.UNABLE_TO_PERSIST_DATA));
    }
  }

  /**
   * Internal method to load persisted plugin data
   */
  private async _loadPersistedData(pluginId: string): Promise<string | null> {
    try {
      return await this._pluginUserPersistenceService.loadPluginUserData(pluginId);
    } catch (error) {
      PluginLog.err('PluginBridge: Failed to get persisted plugin data:', error);
      return null;
    }
  }

  /**
   * Internal method to get plugin configuration
   */
  private async _getConfig(pluginId: string): Promise<any> {
    try {
      return await this._pluginConfigService.getPluginConfig(pluginId);
    } catch (error) {
      PluginLog.err('PluginBridge: Failed to get plugin config:', error);
      return null;
    }
  }

  /**
   * Internal method to trigger sync
   */
  private async _triggerSync(pluginId: string): Promise<void> {
    try {
      console.log('PluginBridge: Triggering sync for plugin', pluginId);
      await this._syncWrapperService.sync();
      PluginLog.log('PluginBridge: Sync completed successfully');
    } catch (error) {
      PluginLog.err('PluginBridge: Sync failed:', error);
      throw error;
    }
  }

  /**
   * Register a hook handler for a plugin
   */
  registerHook<T extends Hooks>(
    pluginId: string,
    hook: T,
    handler: PluginHookHandler<T>,
  ): void {
    typia.assert<string>(pluginId);
    typia.assert<Hooks>(hook);
    // Note: Can't assert generic function type with typia

    this._pluginHooksService.registerHookHandler(pluginId, hook, handler);
  }

  /**
   * Unregister all hooks for a plugin
   */
  unregisterPluginHooks(pluginId: string): void {
    typia.assert<string>(pluginId);

    this._pluginHooksService.unregisterPluginHooks(pluginId);
    this._removePluginHeaderButtons(pluginId);
    this._removePluginMenuEntries(pluginId);
    this._removePluginSidePanelButtons(pluginId);
    this.unregisterPluginShortcuts(pluginId);

    // Clean up window focus handler
    this._windowFocusHandlers.delete(pluginId);

    console.log('PluginBridge: All hooks unregistered for plugin', { pluginId });
  }

  /**
   * Internal method to register header button
   */
  private _registerHeaderButton(
    pluginId: string,
    headerBtnCfg: PluginHeaderBtnCfg,
  ): void {
    typia.assert<Omit<PluginHeaderBtnCfg, 'pluginId'>>(headerBtnCfg);

    const newButton: PluginHeaderBtnCfg = {
      ...headerBtnCfg,
      pluginId,
    };

    const currentButtons = this._headerButtons();
    this._headerButtons.set([...currentButtons, newButton]);

    console.log('PluginBridge: Header button registered', {
      pluginId,
      headerBtnCfg,
    });
  }

  /**
   * Internal method to register menu entry
   */
  private _registerMenuEntry(
    pluginId: string,
    menuEntryCfg: Omit<PluginMenuEntryCfg, 'pluginId'>,
  ): void {
    // Validate required fields manually since typia has issues with optional fields
    if (!menuEntryCfg.label || typeof menuEntryCfg.label !== 'string') {
      throw new Error(
        this._translateService.instant(T.PLUGINS.MENU_ENTRY_LABEL_REQUIRED),
      );
    }
    if (!menuEntryCfg.onClick || typeof menuEntryCfg.onClick !== 'function') {
      throw new Error(
        this._translateService.instant(T.PLUGINS.MENU_ENTRY_ONCLICK_REQUIRED),
      );
    }
    if (menuEntryCfg.icon !== undefined && typeof menuEntryCfg.icon !== 'string') {
      throw new Error(this._translateService.instant(T.PLUGINS.MENU_ENTRY_ICON_STRING));
    }

    const newMenuEntry: PluginMenuEntryCfg = {
      ...menuEntryCfg,
      pluginId,
    };

    const currentEntries = this._menuEntries();

    // Check for duplicate entry (same plugin ID and label)
    const isDuplicate = currentEntries.some(
      (entry) => entry.pluginId === pluginId && entry.label === menuEntryCfg.label,
    );

    if (isDuplicate) {
      PluginLog.err(
        'PluginBridge: Duplicate menu entry detected, skipping registration',
        {
          pluginId,
          label: menuEntryCfg.label,
        },
      );
      return;
    }

    this._menuEntries.set([...currentEntries, newMenuEntry]);

    PluginLog.log('PluginBridge: Menu entry registered', {
      pluginId,
      menuEntryCfg,
    });
  }

  /**
   * Remove all header buttons for a specific plugin
   */
  private _removePluginHeaderButtons(pluginId: string): void {
    const currentButtons = this._headerButtons();
    const filteredButtons = currentButtons.filter(
      (button) => button.pluginId !== pluginId,
    );
    this._headerButtons.set(filteredButtons);

    PluginLog.log('PluginBridge: Header buttons removed for plugin', { pluginId });
  }

  /**
   * Remove all menu entries for a specific plugin
   */
  private _removePluginMenuEntries(pluginId: string): void {
    const currentEntries = this._menuEntries();
    const filteredEntries = currentEntries.filter((entry) => entry.pluginId !== pluginId);
    this._menuEntries.set(filteredEntries);

    PluginLog.log('PluginBridge: Menu entries removed for plugin', { pluginId });
  }

  /**
   * Internal method to register side panel button
   */
  private _registerSidePanelButton(
    pluginId: string,
    sidePanelBtnCfg: Omit<PluginSidePanelBtnCfg, 'pluginId'>,
  ): void {
    // Validate required fields
    if (!sidePanelBtnCfg.label || typeof sidePanelBtnCfg.label !== 'string') {
      throw new Error(
        this._translateService.instant(T.PLUGINS.SIDE_PANEL_LABEL_REQUIRED),
      );
    }
    if (!sidePanelBtnCfg.onClick || typeof sidePanelBtnCfg.onClick !== 'function') {
      throw new Error(
        this._translateService.instant(T.PLUGINS.SIDE_PANEL_ONCLICK_REQUIRED),
      );
    }

    const newButton: PluginSidePanelBtnCfg = {
      ...sidePanelBtnCfg,
      pluginId,
    };

    const currentButtons = this._sidePanelButtons();

    // Check for duplicate button (same plugin ID)
    const isDuplicate = currentButtons.some((button) => button.pluginId === pluginId);

    if (isDuplicate) {
      PluginLog.err(
        'PluginBridge: Duplicate side panel button detected, skipping registration',
        {
          pluginId,
          label: sidePanelBtnCfg.label,
        },
      );
      return;
    }

    this._sidePanelButtons.set([...currentButtons, newButton]);

    PluginLog.log('PluginBridge: Side panel button registered', {
      pluginId,
      sidePanelBtnCfg,
    });
  }

  /**
   * Remove all side panel buttons for a specific plugin
   */
  private _removePluginSidePanelButtons(pluginId: string): void {
    const currentButtons = this._sidePanelButtons();
    const filteredButtons = currentButtons.filter(
      (button) => button.pluginId !== pluginId,
    );
    this._sidePanelButtons.set(filteredButtons);

    PluginLog.log('PluginBridge: Side panel buttons removed for plugin', { pluginId });
  }

  /**
   * Internal method to register shortcut
   */
  private _registerShortcut(pluginId: string, shortcutCfg: PluginShortcutCfg): void {
    const shortcutWithPluginId: PluginShortcutCfg = {
      ...shortcutCfg,
      pluginId,
    };

    const currentShortcuts = this.shortcuts();
    this.shortcuts.set([...currentShortcuts, shortcutWithPluginId]);

    PluginLog.log('PluginBridge: Shortcut registered', {
      pluginId,
      shortcut: shortcutWithPluginId,
    });
  }

  /**
   * Execute a shortcut by its ID (pluginId:id)
   */
  async executeShortcut(shortcutId: string): Promise<boolean> {
    const shortcuts = this.shortcuts();
    const shortcut = shortcuts.find((s) => `${s.pluginId}:${s.id}` === shortcutId);

    if (shortcut) {
      try {
        await Promise.resolve(shortcut.onExec());
        PluginLog.log(
          `Executed shortcut "${shortcut.label}" from plugin ${shortcut.pluginId}`,
        );
        return true;
      } catch (error) {
        PluginLog.err(`Failed to execute shortcut "${shortcut.label}":`, error);
        return false;
      }
    }

    return false;
  }

  /**
   * Unregister all shortcuts for a specific plugin
   */
  unregisterPluginShortcuts(pluginId: string): void {
    const currentShortcuts = this.shortcuts();
    const filteredShortcuts = currentShortcuts.filter(
      (shortcut) => shortcut.pluginId !== pluginId,
    );

    if (filteredShortcuts.length !== currentShortcuts.length) {
      this.shortcuts.set(filteredShortcuts);
      PluginLog.log(
        `Unregistered ${currentShortcuts.length - filteredShortcuts.length} shortcuts for plugin ${pluginId}`,
      );
    }
  }

  /**
   * Validate that referenced project, tags, and parent task exist
   */
  private async _validateTaskReferences(
    projectId?: string | null,
    tagIds?: string[],
    parentId?: string | null,
  ): Promise<void> {
    const errors: string[] = [];

    // Validate project exists if provided
    if (projectId) {
      const projects = await this._projectService.list$.pipe(first()).toPromise();

      const projectExists = projects?.some((project) => project.id === projectId);
      if (!projectExists) {
        errors.push(
          this._translateService.instant(T.PLUGINS.PROJECT_DOES_NOT_EXIST, { projectId }),
        );
      }
    }

    // Validate tags exist if provided
    if (tagIds && tagIds.length > 0) {
      const tags = await this._tagService.tags$.pipe(first()).toPromise();

      const existingTagIds = tags?.map((tag) => tag.id) || [];
      const nonExistentTags = tagIds.filter((tagId) => !existingTagIds.includes(tagId));

      if (nonExistentTags.length > 0) {
        errors.push(
          this._translateService.instant(T.PLUGINS.TAGS_DO_NOT_EXIST, {
            tagIds: nonExistentTags.join(', '),
          }),
        );
      }
    }

    // Validate parent task exists if provided
    if (parentId) {
      const tasks = await this._taskService.allTasks$.pipe(first()).toPromise();

      const parentExists = tasks?.some((task) => task.id === parentId);
      if (!parentExists) {
        errors.push(
          this._translateService.instant(T.PLUGINS.PARENT_TASK_DOES_NOT_EXIST, {
            parentId,
          }),
        );
      }
    }

    // Throw error if any validation failed
    if (errors.length > 0) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.VALIDATION_FAILED, {
          errors: errors.join('; '),
        }),
      );
    }
  }

  /**
   * Internal method to dispatch action
   */
  private _dispatchAction(
    pluginId: string,
    action: { type: string; [key: string]: unknown },
  ): void {
    // Check if the action is in the allowed list
    if (!isAllowedPluginAction(action)) {
      PluginLog.err(
        `PluginBridge: Action type '${action.type}' is not allowed for plugins`,
      );
      throw new Error(
        this._translateService.instant(T.PLUGINS.ACTION_TYPE_NOT_ALLOWED, {
          actionType: action.type,
        }),
      );
    }

    // Dispatch the action
    this._store.dispatch(action);
    PluginLog.log(`PluginBridge: Dispatched action for plugin ${pluginId}`, {
      actionType: action.type,
      payload: action,
    });
  }

  /**
   * Internal method to execute Node.js script
   */
  private async _executeNodeScript(
    pluginId: string,
    manifest: PluginManifest | null,
    request: PluginNodeScriptRequest,
  ): Promise<PluginNodeScriptResult> {
    if (!IS_ELECTRON) {
      return {
        success: false,
        error: this._translateService.instant(T.PLUGINS.NODE_ONLY_DESKTOP),
      };
    }

    try {
      typia.assert<PluginNodeScriptRequest>(request);

      if (!manifest) {
        return {
          success: false,
          error: this._translateService.instant(T.PLUGINS.NO_PLUGIN_MANIFEST_NODE),
        };
      }

      // Check if Electron API is available
      if (!window.ea || typeof window.ea.pluginExecNodeScript !== 'function') {
        return {
          success: false,
          error: this._translateService.instant(T.PLUGINS.ELECTRON_API_NOT_AVAILABLE),
        };
      }

      // Call Electron main process via IPC
      const result = await window.ea.pluginExecNodeScript(pluginId, manifest, request);

      return result;
    } catch (error) {
      PluginLog.err('PluginBridge: Failed to execute Node.js script:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : this._translateService.instant(T.PLUGINS.FAILED_TO_EXECUTE_SCRIPT),
      };
    }
  }

  /**
   * Send a message to a plugin's message handler
   */
  async sendMessageToPlugin(pluginId: string, message: unknown): Promise<unknown> {
    // Import and get the plugin runner service
    // Using dynamic import to avoid circular dependency at compile time
    const { PluginRunner } = await import('./plugin-runner');
    const pluginRunner = this._injector.get(PluginRunner);
    return pluginRunner.sendMessageToPlugin(pluginId, message);
  }

  /**
   * Track window focus state
   */
  private _isWindowFocused = true;
  private _windowFocusHandlers = new Map<string, (isFocused: boolean) => void>();

  /**
   * Initialize window focus tracking
   */
  private _initWindowFocusTracking(): void {
    // Track window focus/blur events
    window.addEventListener('focus', () => {
      this._isWindowFocused = true;
      this._notifyFocusHandlers(true);
    });

    window.addEventListener('blur', () => {
      this._isWindowFocused = false;
      this._notifyFocusHandlers(false);
    });

    // Also track document visibility changes
    document.addEventListener('visibilitychange', () => {
      const isFocused = !document.hidden;
      this._isWindowFocused = isFocused;
      this._notifyFocusHandlers(isFocused);
    });
  }

  /**
   * Notify all registered focus handlers
   */
  private _notifyFocusHandlers(isFocused: boolean): void {
    this._windowFocusHandlers.forEach((handler) => {
      try {
        handler(isFocused);
      } catch (error) {
        console.error('Error in window focus handler:', error);
      }
    });
  }

  /**
   * Check if the window is currently focused
   */
  isWindowFocused(): boolean {
    return this._isWindowFocused;
  }

  /**
   * Register a handler for window focus changes
   */
  onWindowFocusChange(pluginId: string, handler: (isFocused: boolean) => void): void {
    this._windowFocusHandlers.set(pluginId, handler);

    // Immediately notify the handler of the current state
    handler(this._isWindowFocused);
  }

  /**
   * Gets all simple counters as { [key: string]: number }.
   */
  async getAllCounters(): Promise<{ [key: string]: number }> {
    const today = new Date().toISOString().split('T')[0];
    const countersArray = await this._store
      .select(selectAllSimpleCounters)
      .pipe(
        take(1),
        map((counters: SimpleCounter[]) =>
          counters.reduce(
            (acc, c) => ({ ...acc, [c.id]: c.countOnDay?.[today] ?? 0 }),
            {} as { [key: string]: number },
          ),
        ),
      )
      .toPromise();
    return countersArray || {};
  }

  /**
   * Gets a single simple counter value (undefined if unset).
   * @param key The counter key (e.g., 'daily-commits').
   */
  async getCounter(id: string): Promise<number | null> {
    typia.assert<string>(id);
    // Allow uppercase, lowercase, numbers, hyphens, underscores
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error('Invalid counter key: must be alphanumeric with hyphens');
    }
    const counters = await this.getAllCounters();
    return counters[id] ?? null;
  }

  async setCounter(id: string, value: number): Promise<void> {
    typia.assert<string>(id);
    typia.assert<number>(value);
    // Allow uppercase, lowercase, numbers, hyphens, underscores
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error('Invalid counter key: must be alphanumeric with hyphens');
    }
    if (typeof value !== 'number' || !isFinite(value) || value < 0) {
      throw new Error('Invalid counter value: must be a non-negative number');
    }
    const today = new Date().toISOString().split('T')[0];

    // Check if counter already exists
    const existingCounter = await this.getSimpleCounter(id);

    if (existingCounter) {
      // Update existing counter's countOnDay only
      this._store.dispatch(
        updateSimpleCounter({
          simpleCounter: {
            id,
            changes: {
              countOnDay: {
                ...existingCounter.countOnDay,
                [today]: value,
              },
            },
          },
        }),
      );
    } else {
      // Create new counter with all mandatory fields
      this._store.dispatch(
        upsertSimpleCounter({
          simpleCounter: {
            ...EMPTY_SIMPLE_COUNTER,
            id,
            title: id,
            isEnabled: true,
            type: SimpleCounterType.ClickCounter,
            countOnDay: { [today]: value },
          },
        }),
      );
    }
  }

  async incrementCounter(id: string, incrementBy = 1): Promise<number> {
    typia.assert<string>(id);
    typia.assert<number>(incrementBy);
    if (typeof incrementBy !== 'number' || !isFinite(incrementBy) || incrementBy <= 0) {
      throw new Error('Invalid increment amount: must be a positive number');
    }
    const current = (await this.getCounter(id)) ?? 0;
    const newValue = current + incrementBy;
    await this.setCounter(id, newValue);
    return newValue;
  }

  async decrementCounter(id: string, decrementBy = 1): Promise<number> {
    typia.assert<string>(id);
    typia.assert<number>(decrementBy);
    if (typeof decrementBy !== 'number' || !isFinite(decrementBy) || decrementBy <= 0) {
      throw new Error('Invalid decrement amount: must be a positive number');
    }
    const current = (await this.getCounter(id)) ?? 0;
    const newValue = Math.max(0, current - decrementBy);
    await this.setCounter(id, Math.max(0, newValue));
    return newValue;
  }

  /**
   * Gets all simple counters as SimpleCounter[].
   */
  async getAllSimpleCounters(): Promise<SimpleCounter[]> {
    return this._store.select(selectAllSimpleCounters).pipe(take(1)).toPromise();
  }

  /**
   * Gets a single simple counter by ID.
   * @param id The counter ID.
   */
  async getSimpleCounter(id: string): Promise<SimpleCounter | undefined> {
    const all = await this.getAllSimpleCounters();
    return all.find((c) => c.id === id);
  }

  /**
   * Updates a simple counter (partial).
   * @param id The counter ID.
   * @param updates Partial updates.
   */
  async updateSimpleCounter(id: string, updates: Partial<SimpleCounter>): Promise<void> {
    this._store.dispatch(
      updateSimpleCounter({
        simpleCounter: { id, changes: updates },
      }),
    );
  }

  /**
   * Toggles a simple counter's isOn state.
   * @param id The counter ID.
   */
  async toggleSimpleCounter(id: string): Promise<void> {
    const counter = await this.getSimpleCounter(id);
    if (!counter) {
      throw new Error(`Counter ${id} not found`);
    }
    this._store.dispatch(toggleSimpleCounterCounter({ id }));
  }

  /**
   * Sets a simple counter's isEnabled state.
   * @param id The counter ID.
   * @param isEnabled Enabled state.
   */
  async setSimpleCounterEnabled(id: string, isEnabled: boolean): Promise<void> {
    return this.updateSimpleCounter(id, { isEnabled });
  }

  /**
   * Deletes a simple counter.
   * @param id The counter ID.
   */
  async deleteSimpleCounter(id: string): Promise<void> {
    this._store.dispatch(deleteSimpleCounter({ id }));
  }

  /**
   * Sets a simple counter value for today.
   * @param id The counter ID.
   * @param value The numeric value.
   */
  async setSimpleCounterToday(id: string, value: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    return this.setSimpleCounterDate(id, today, value);
  }

  /**
   * Sets a simple counter value for a specific date.
   * @param id The counter ID.
   * @param date The date (`YYYY-MM-DD`).
   * @param value The numeric value.
   */
  async setSimpleCounterDate(id: string, date: string, value: number): Promise<void> {
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      throw new Error('Invalid date format: use YYYY-MM-DD');
    }
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      throw new Error('Invalid date: must be valid YYYY-MM-DD');
    }
    const counter = await this.getSimpleCounter(id);
    if (!counter) {
      throw new Error(`Counter ${id} not found`);
    }
    if (typeof value !== 'number' || !isFinite(value) || value < 0) {
      throw new Error('Invalid counter value: must be a non-negative number');
    }
    const newCountOnDay = { ...counter.countOnDay, [date]: value };
    return this.updateSimpleCounter(id, { countOnDay: newCountOnDay });
  }

  /**
   * Clean up all resources when service is destroyed
   */
  ngOnDestroy(): void {
    PluginLog.log('PluginBridgeService: Cleaning up resources');
    // Note: Signals don't need explicit cleanup like BehaviorSubjects
    PluginLog.log('PluginBridgeService: Cleanup complete');
  }
}
