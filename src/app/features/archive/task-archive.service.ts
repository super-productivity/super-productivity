import { inject, Injectable, Injector } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { roundTimeSpentForDay } from '../tasks/store/task.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TASK_FEATURE_NAME, taskReducer } from '../tasks/store/task.reducer';
import { taskSharedCrudMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer';
import { tagSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/tag-shared.reducer';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { Task, TaskArchive, TaskState } from '../tasks/task.model';
import { RoundTimeOption } from '../project/project.model';
import { Update } from '@ngrx/entity';
import { ArchiveModel } from './archive.model';
import { initialTimeTrackingState } from '../time-tracking/store/time-tracking.reducer';
import { RootState } from '../../root-store/root-state';
import { PROJECT_FEATURE_NAME } from '../project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../tag/store/tag.reducer';
import { WORK_CONTEXT_FEATURE_NAME } from '../work-context/store/work-context.selectors';
import { plannerFeatureKey } from '../planner/store/planner.reducer';

// Default empty archive
const DEFAULT_ARCHIVE: ArchiveModel = {
  task: { ids: [], entities: {} },
  timeTracking: initialTimeTrackingState,
  lastTimeTrackingFlush: 0,
};

// Create a minimal RootState with the archive task state
// Other feature states are empty as they're not needed for task updates
const FAKE_ROOT_STATE: RootState = {
  [PROJECT_FEATURE_NAME]: { ids: [], entities: {} },
  [TAG_FEATURE_NAME]: { ids: [], entities: {} },
  [WORK_CONTEXT_FEATURE_NAME]: {
    activeId: 'xyz',
    activeType: 'TAG',
  },
  [plannerFeatureKey]: { days: {}, addPlannedTasksDialogLastShown: undefined },
} as const as Partial<RootState> as RootState;

type TaskArchiveAction =
  | ReturnType<typeof TaskSharedActions.updateTask>
  | ReturnType<typeof TaskSharedActions.deleteTasks>
  | ReturnType<typeof TaskSharedActions.removeTagsForAllTasks>
  | ReturnType<typeof roundTimeSpentForDay>;

@Injectable({
  providedIn: 'root',
})
export class TaskArchiveService {
  private _injector = inject(Injector);
  private _archiveDbAdapter?: ArchiveDbAdapter;
  private get archiveDbAdapter(): ArchiveDbAdapter {
    if (!this._archiveDbAdapter) {
      this._archiveDbAdapter = this._injector.get(ArchiveDbAdapter);
    }
    return this._archiveDbAdapter;
  }

  private _store?: Store;
  private get store(): Store {
    if (!this._store) {
      this._store = this._injector.get(Store);
    }
    return this._store;
  }

  // Cached reducer chain to avoid recreating on every call
  private _cachedReducer?: (state: RootState, action: Action) => RootState;
  private get cachedReducer(): (state: RootState, action: Action) => RootState {
    if (!this._cachedReducer) {
      const baseReducer = (state: RootState, act: Action): RootState => ({
        ...state,
        [TASK_FEATURE_NAME]: taskReducer(state[TASK_FEATURE_NAME], act),
      });
      const reducerWithCrud = taskSharedCrudMetaReducer(baseReducer);
      this._cachedReducer = tagSharedMetaReducer(reducerWithCrud);
    }
    return this._cachedReducer;
  }

  constructor() {}

  async loadYoung(): Promise<TaskArchive> {
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    return {
      ids: archiveYoung.task.ids,
      entities: archiveYoung.task.entities,
    };
  }

  async load(): Promise<TaskArchive> {
    // NOTE: these are already saved in memory to speed up things
    const [archiveYoung, archiveOld] = await Promise.all([
      this.archiveDbAdapter.loadArchiveYoung(),
      this.archiveDbAdapter.loadArchiveOld(),
    ]);

    const young = archiveYoung || DEFAULT_ARCHIVE;
    const old = archiveOld || DEFAULT_ARCHIVE;

    return {
      ids: [...young.task.ids, ...old.task.ids],
      entities: {
        ...young.task.entities,
        ...old.task.entities,
      },
    };
  }

  async getById(id: string): Promise<Task> {
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    if (archiveYoung.task.entities[id]) {
      return archiveYoung.task.entities[id];
    }
    const archiveOld = (await this.archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
    if (archiveOld.task.entities[id]) {
      return archiveOld.task.entities[id];
    }
    throw new Error('Archive task not found by id');
  }

  /**
   * Checks if a task exists in either archive (young or old).
   */
  async hasTask(id: string): Promise<boolean> {
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    if (archiveYoung.task.entities[id]) {
      return true;
    }
    const archiveOld = (await this.archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
    return !!archiveOld.task.entities[id];
  }

  async deleteTasks(
    taskIdsToDelete: string[],
    options?: { isIgnoreDBLock?: boolean },
  ): Promise<void> {
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const toDeleteInArchiveYoung = taskIdsToDelete.filter(
      (id) => !!archiveYoung.task.entities[id],
    );

    if (toDeleteInArchiveYoung.length > 0) {
      const newTaskState = this._reduceForArchive(
        archiveYoung,
        TaskSharedActions.deleteTasks({ taskIds: toDeleteInArchiveYoung }),
      );
      await this.archiveDbAdapter.saveArchiveYoung({
        ...archiveYoung,
        task: newTaskState,
      });
    }

    if (toDeleteInArchiveYoung.length < taskIdsToDelete.length) {
      const archiveOld =
        (await this.archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
      const toDeleteInArchiveOld = taskIdsToDelete.filter(
        (id) => !!archiveOld.task.entities[id],
      );
      const newTaskStateArchiveOld = this._reduceForArchive(
        archiveOld,
        TaskSharedActions.deleteTasks({ taskIds: toDeleteInArchiveOld }),
      );
      await this.archiveDbAdapter.saveArchiveOld({
        ...archiveOld,
        task: newTaskStateArchiveOld,
      });
    }
  }

  async updateTask(
    id: string,
    changedFields: Partial<Task>,
    options?: { isSkipDispatch?: boolean; isIgnoreDBLock?: boolean },
  ): Promise<void> {
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    if (archiveYoung.task.entities[id]) {
      await this._execAction(
        'archiveYoung',
        archiveYoung,
        TaskSharedActions.updateTask({ task: { id, changes: changedFields } }),
      );
      // Dispatch persistent action for sync (skip for remote handler calls)
      if (!options?.isSkipDispatch) {
        this.store.dispatch(
          TaskSharedActions.updateTask({ task: { id, changes: changedFields } }),
        );
      }
      return;
    }
    const archiveOld = (await this.archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
    if (archiveOld.task.entities[id]) {
      await this._execAction(
        'archiveOld',
        archiveOld,
        TaskSharedActions.updateTask({ task: { id, changes: changedFields } }),
      );
      // Dispatch persistent action for sync (skip for remote handler calls)
      if (!options?.isSkipDispatch) {
        this.store.dispatch(
          TaskSharedActions.updateTask({ task: { id, changes: changedFields } }),
        );
      }
      return;
    }
    throw new Error('Archive task to update not found');
  }

  async updateTasks(
    updates: Update<Task>[],
    options?: { isSkipDispatch?: boolean; isIgnoreDBLock?: boolean },
  ): Promise<void> {
    const allUpdates = updates.map((upd) => TaskSharedActions.updateTask({ task: upd }));
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const updatesYoung = allUpdates.filter(
      (upd) => !!archiveYoung.task.entities[upd.task.id],
    );
    if (updatesYoung.length > 0) {
      let currentArchiveYoung = archiveYoung;
      for (const act of updatesYoung) {
        const newTaskState = this._reduceForArchive(currentArchiveYoung, act);
        currentArchiveYoung = { ...currentArchiveYoung, task: newTaskState };
      }
      const newTaskStateArchiveYoung = currentArchiveYoung.task;
      await this.archiveDbAdapter.saveArchiveYoung({
        ...archiveYoung,
        task: newTaskStateArchiveYoung,
      });
    }

    if (updatesYoung.length < updates.length) {
      const archiveOld =
        (await this.archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
      const updatesOld = allUpdates.filter(
        (upd) => !!archiveOld.task.entities[upd.task.id],
      );
      let currentArchiveOld = archiveOld;
      for (const act of updatesOld) {
        const newTaskState = this._reduceForArchive(currentArchiveOld, act);
        currentArchiveOld = { ...currentArchiveOld, task: newTaskState };
      }
      const newTaskStateArchiveOld = currentArchiveOld.task;
      await this.archiveDbAdapter.saveArchiveOld({
        ...archiveOld,
        task: newTaskStateArchiveOld,
      });
    }

    // Dispatch batch action for sync (skip for remote handler calls)
    // Using updateTasks (batch) instead of individual updateTask to create
    // a single operation instead of N operations. This is critical for
    // repeating task config updates that affect many archived instances.
    if (!options?.isSkipDispatch) {
      this.store.dispatch(TaskSharedActions.updateTasks({ tasks: updates }));
    }
  }

  // -----------------------------------------
  async removeAllArchiveTasksForProject(
    projectIdToDelete: string,
    options?: { isIgnoreDBLock?: boolean },
  ): Promise<void> {
    const taskArchiveState: TaskArchive = await this.load();
    const archiveTaskIdsToDelete = !!taskArchiveState
      ? (taskArchiveState.ids as string[]).filter((id) => {
          const t = taskArchiveState.entities[id] as Task;
          if (!t) {
            throw new Error('No task');
          }
          return t.projectId === projectIdToDelete;
        })
      : [];
    await this.deleteTasks(archiveTaskIdsToDelete, options);
  }

  async removeTagsFromAllTasks(
    tagIdsToRemove: string[],
    options?: { isIgnoreDBLock?: boolean },
  ): Promise<void> {
    const taskArchiveState: TaskArchive = await this.load();
    await this._execActionBoth(
      TaskSharedActions.removeTagsForAllTasks({ tagIdsToRemove }),
    );

    const isOrphanedParentTask = (t: Task): boolean =>
      !t.projectId && !t.tagIds.length && !t.parentId;

    // remove orphaned for archive

    let archiveSubTaskIdsToDelete: string[] = [];
    const archiveMainTaskIdsToDelete: string[] = [];
    (taskArchiveState.ids as string[]).forEach((id) => {
      const t = taskArchiveState.entities[id] as Task;
      if (isOrphanedParentTask(t)) {
        archiveMainTaskIdsToDelete.push(id);
        archiveSubTaskIdsToDelete = archiveSubTaskIdsToDelete.concat(t.subTaskIds);
      }
    });
    // TODO check to maybe update to today tag instead
    await this.deleteTasks(
      [...archiveMainTaskIdsToDelete, ...archiveSubTaskIdsToDelete],
      options,
    );
  }

  async removeRepeatCfgFromArchiveTasks(
    repeatConfigId: string,
    options?: { isIgnoreDBLock?: boolean },
  ): Promise<void> {
    const taskArchive = await this.load();

    const newState = { ...taskArchive };
    const ids = newState.ids as string[];

    const tasksWithRepeatCfgId = ids
      .map((id) => newState.entities[id] as Task)
      .filter((task) => task.repeatCfgId === repeatConfigId);

    if (tasksWithRepeatCfgId && tasksWithRepeatCfgId.length) {
      const updates: Update<Task>[] = tasksWithRepeatCfgId.map((t) => {
        return {
          id: t.id,
          changes: {
            // TODO check if undefined causes problems
            repeatCfgId: undefined,
          },
        };
      });
      await this.updateTasks(updates, {
        isSkipDispatch: true,
        isIgnoreDBLock: options?.isIgnoreDBLock,
      });
    }
  }

  async unlinkIssueProviderFromArchiveTasks(
    issueProviderId: string,
    options?: { isIgnoreDBLock?: boolean },
  ): Promise<void> {
    const taskArchive = await this.load();

    const tasksWithIssueProvider = (taskArchive.ids as string[])
      .map((id) => taskArchive.entities[id] as Task)
      .filter((task) => task.issueProviderId === issueProviderId);

    if (tasksWithIssueProvider.length > 0) {
      const updates: Update<Task>[] = tasksWithIssueProvider.map((t) => ({
        id: t.id,
        changes: {
          issueId: undefined,
          issueProviderId: undefined,
          issueType: undefined,
          issueWasUpdated: undefined,
          issueLastUpdated: undefined,
          issueAttachmentNr: undefined,
          issueTimeTracked: undefined,
          issuePoints: undefined,
        },
      }));
      await this.updateTasks(updates, {
        isSkipDispatch: true,
        isIgnoreDBLock: options?.isIgnoreDBLock,
      });
    }
  }

  async roundTimeSpent({
    day,
    taskIds,
    roundTo,
    isRoundUp = false,
    projectId,
  }: {
    day: string;
    taskIds: string[];
    roundTo: RoundTimeOption;
    isRoundUp: boolean;
    projectId?: string | null;
  }): Promise<void> {
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const taskIdsInArchiveYoung = taskIds.filter(
      (id) => !!archiveYoung.task.entities[id],
    );
    if (taskIdsInArchiveYoung.length > 0) {
      const newTaskState = this._reduceForArchive(
        archiveYoung,
        roundTimeSpentForDay({
          day,
          taskIds: taskIdsInArchiveYoung,
          roundTo,
          isRoundUp,
          projectId,
        }),
      );
      await this.archiveDbAdapter.saveArchiveYoung({
        ...archiveYoung,
        task: newTaskState,
      });
    }
    if (taskIdsInArchiveYoung.length < taskIds.length) {
      const archiveOld =
        (await this.archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
      const taskIdsInArchiveOld = taskIds.filter((id) => !!archiveOld.task.entities[id]);
      if (taskIdsInArchiveOld.length > 0) {
        const newTaskStateArchiveOld = this._reduceForArchive(
          archiveOld,
          roundTimeSpentForDay({
            day,
            taskIds: taskIdsInArchiveOld,
            roundTo,
            isRoundUp,
            projectId,
          }),
        );
        await this.archiveDbAdapter.saveArchiveOld({
          ...archiveOld,
          task: newTaskStateArchiveOld,
        });
      }
    }
  }

  // -----------------------------------------

  private async _execAction(
    target: 'archiveYoung' | 'archiveOld',
    archiveBefore: ArchiveModel,
    action: TaskArchiveAction,
  ): Promise<void> {
    const newTaskState = this._reduceForArchive(archiveBefore, action);
    if (target === 'archiveYoung') {
      await this.archiveDbAdapter.saveArchiveYoung({
        ...archiveBefore,
        task: newTaskState,
      });
    } else {
      await this.archiveDbAdapter.saveArchiveOld({
        ...archiveBefore,
        task: newTaskState,
      });
    }
  }

  private async _execActionBoth(action: TaskArchiveAction): Promise<void> {
    const archiveYoung =
      (await this.archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const newTaskState = this._reduceForArchive(archiveYoung, action);

    const archiveOld = (await this.archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
    const newTaskStateArchiveOld = this._reduceForArchive(archiveOld, action);

    await this.archiveDbAdapter.saveArchiveYoung({
      ...archiveYoung,
      task: newTaskState,
    });
    await this.archiveDbAdapter.saveArchiveOld({
      ...archiveOld,
      task: newTaskStateArchiveOld,
    });
  }

  private _reduceForArchive(
    archiveBefore: ArchiveModel,
    action: TaskArchiveAction,
  ): TaskState {
    // Create root state with the actual archive task state
    const rootStateWithArchiveTasks: RootState = {
      ...FAKE_ROOT_STATE,
      [TASK_FEATURE_NAME]: archiveBefore.task as TaskState,
    };

    // Apply the action through the cached reducer chain
    const updatedRootState = this.cachedReducer(rootStateWithArchiveTasks, action);

    // Extract and return the updated task state
    return updatedRootState[TASK_FEATURE_NAME];
  }
}
