import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { combineLatest, firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';

import { selectBoardsState } from '../../features/boards/store/boards.selectors';
import { selectConfigFeatureState } from '../../features/config/store/global-config.reducer';
import { selectIssueProviderState } from '../../features/issue/store/issue-provider.selectors';
import { selectMenuTreeState } from '../../features/menu-tree/store/menu-tree.selectors';
import { selectMetricFeatureState } from '../../features/metric/store/metric.selectors';
import { selectPluginUserDataFeatureState } from '../../plugins/store/plugin-user-data.reducer';
import { selectPluginMetadataFeatureState } from '../../plugins/store/plugin-metadata.reducer';
import { selectReminderFeatureState } from '../../features/reminder/store/reminder.reducer';
import { selectNoteFeatureState } from '../../features/note/store/note.reducer';
import { selectPlannerState } from '../../features/planner/store/planner.selectors';
import { selectProjectFeatureState } from '../../features/project/store/project.selectors';
import { selectSimpleCounterFeatureState } from '../../features/simple-counter/store/simple-counter.reducer';
import { selectTagFeatureState } from '../../features/tag/store/tag.reducer';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { selectTaskRepeatCfgFeatureState } from '../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectTimeTrackingState } from '../../features/time-tracking/store/time-tracking.selectors';
import { environment } from '../../../environments/environment';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';

import { AppStateSnapshot } from '../core/types/backup.types';

// Re-export for consumers that import from this service
export type { AppStateSnapshot } from '../core/types/backup.types';

const DEFAULT_ARCHIVE: ArchiveModel = {
  task: { ids: [], entities: {} },
  timeTracking: initialTimeTrackingState,
  lastTimeTrackingFlush: 0,
};

/**
 * Service that reads complete application state from NgRx store and IndexedDB.
 *
 * Most models are persisted via OperationLogEffects to SUP_OPS IndexedDB, so we read from NgRx.
 * Archives (archiveYoung, archiveOld) are read from SUP_OPS via ArchiveDbAdapter.
 *
 * ## Usage
 * ```typescript
 * const snapshot = inject(StateSnapshotService);
 *
 * // Sync read (without archives)
 * const state = snapshot.getStateSnapshot();
 *
 * // Async read (with archives)
 * const stateWithArchives = await snapshot.getStateSnapshotAsync();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class StateSnapshotService {
  private _store = inject(Store);
  private _archiveDbAdapter = inject(ArchiveDbAdapter);

  /**
   * Gets all sync model data from NgRx store.
   * Archives are returned with default empty values - use async version for actual archives.
   */
  getStateSnapshot(): AppStateSnapshot {
    const ngRxData = this._getNgRxDataSync();

    return {
      ...ngRxData,
      archiveYoung: DEFAULT_ARCHIVE,
      archiveOld: DEFAULT_ARCHIVE,
    };
  }

  /**
   * Alias for getStateSnapshot() for backward compatibility
   * @deprecated Use getStateSnapshot() instead
   */
  getAllSyncModelDataFromStore(): AppStateSnapshot {
    return this.getStateSnapshot();
  }

  /**
   * Async version that also loads archives from IndexedDB
   */
  async getStateSnapshotAsync(): Promise<AppStateSnapshot> {
    const [archiveYoung, archiveOld] = await Promise.all([
      this._loadArchive('archiveYoung'),
      this._loadArchive('archiveOld'),
    ]);

    const ngRxData = await firstValueFrom(
      combineLatest([
        this._store.select(selectTaskFeatureState),
        this._store.select(selectProjectFeatureState),
        this._store.select(selectTagFeatureState),
        this._store.select(selectConfigFeatureState),
        this._store.select(selectNoteFeatureState),
        this._store.select(selectIssueProviderState),
        this._store.select(selectPlannerState),
        this._store.select(selectBoardsState),
        this._store.select(selectMetricFeatureState),
        this._store.select(selectSimpleCounterFeatureState),
        this._store.select(selectTaskRepeatCfgFeatureState),
        this._store.select(selectMenuTreeState),
        this._store.select(selectTimeTrackingState),
        this._store.select(selectPluginUserDataFeatureState),
        this._store.select(selectPluginMetadataFeatureState),
        this._store.select(selectReminderFeatureState),
      ]).pipe(first()),
    );

    const [
      task,
      project,
      tag,
      globalConfig,
      note,
      issueProvider,
      planner,
      boards,
      metric,
      simpleCounter,
      taskRepeatCfg,
      menuTree,
      timeTracking,
      pluginUserData,
      pluginMetadata,
      reminders,
    ] = ngRxData;

    return {
      task: {
        ...(task as object),
        selectedTaskId: environment.production
          ? null
          : ((task as { selectedTaskId?: string | null })?.selectedTaskId ?? null),
        currentTaskId: null,
      },
      project,
      tag,
      globalConfig,
      note,
      issueProvider,
      planner,
      boards,
      metric,
      simpleCounter,
      taskRepeatCfg,
      menuTree,
      timeTracking,
      pluginUserData,
      pluginMetadata,
      reminders,
      archiveYoung,
      archiveOld,
    };
  }

  /**
   * Alias for getStateSnapshotAsync() for backward compatibility
   * @deprecated Use getStateSnapshotAsync() instead
   */
  async getAllSyncModelDataFromStoreAsync(): Promise<AppStateSnapshot> {
    return this.getStateSnapshotAsync();
  }

  private _getNgRxDataSync(): Omit<AppStateSnapshot, 'archiveYoung' | 'archiveOld'> {
    let task: unknown,
      project: unknown,
      tag: unknown,
      globalConfig: unknown,
      note: unknown;
    let issueProvider: unknown, planner: unknown, boards: unknown, metric: unknown;
    let simpleCounter: unknown,
      taskRepeatCfg: unknown,
      menuTree: unknown,
      timeTracking: unknown;
    let pluginUserData: unknown, pluginMetadata: unknown, reminders: unknown;

    // Subscribe synchronously to get current values
    this._store
      .select(selectTaskFeatureState)
      .pipe(first())
      .subscribe((v) => (task = v));
    this._store
      .select(selectProjectFeatureState)
      .pipe(first())
      .subscribe((v) => (project = v));
    this._store
      .select(selectTagFeatureState)
      .pipe(first())
      .subscribe((v) => (tag = v));
    this._store
      .select(selectConfigFeatureState)
      .pipe(first())
      .subscribe((v) => (globalConfig = v));
    this._store
      .select(selectNoteFeatureState)
      .pipe(first())
      .subscribe((v) => (note = v));
    this._store
      .select(selectIssueProviderState)
      .pipe(first())
      .subscribe((v) => (issueProvider = v));
    this._store
      .select(selectPlannerState)
      .pipe(first())
      .subscribe((v) => (planner = v));
    this._store
      .select(selectBoardsState)
      .pipe(first())
      .subscribe((v) => (boards = v));
    this._store
      .select(selectMetricFeatureState)
      .pipe(first())
      .subscribe((v) => (metric = v));
    this._store
      .select(selectSimpleCounterFeatureState)
      .pipe(first())
      .subscribe((v) => (simpleCounter = v));
    this._store
      .select(selectTaskRepeatCfgFeatureState)
      .pipe(first())
      .subscribe((v) => (taskRepeatCfg = v));
    this._store
      .select(selectMenuTreeState)
      .pipe(first())
      .subscribe((v) => (menuTree = v));
    this._store
      .select(selectTimeTrackingState)
      .pipe(first())
      .subscribe((v) => (timeTracking = v));
    this._store
      .select(selectPluginUserDataFeatureState)
      .pipe(first())
      .subscribe((v) => (pluginUserData = v));
    this._store
      .select(selectPluginMetadataFeatureState)
      .pipe(first())
      .subscribe((v) => (pluginMetadata = v));
    this._store
      .select(selectReminderFeatureState)
      .pipe(first())
      .subscribe((v) => (reminders = v));

    return {
      task: {
        ...(task as object),
        selectedTaskId: environment.production
          ? null
          : ((task as { selectedTaskId?: string | null })?.selectedTaskId ?? null),
        currentTaskId: null,
      },
      project,
      tag,
      globalConfig,
      note,
      issueProvider,
      planner,
      boards,
      metric,
      simpleCounter,
      taskRepeatCfg,
      menuTree,
      timeTracking,
      pluginUserData,
      pluginMetadata,
      reminders,
    };
  }

  private async _loadArchive(key: 'archiveYoung' | 'archiveOld'): Promise<ArchiveModel> {
    const archive =
      key === 'archiveYoung'
        ? await this._archiveDbAdapter.loadArchiveYoung()
        : await this._archiveDbAdapter.loadArchiveOld();
    return archive ?? DEFAULT_ARCHIVE;
  }
}

// Re-export with old name for backward compatibility during migration
export { StateSnapshotService as PfapiStoreDelegateService };
