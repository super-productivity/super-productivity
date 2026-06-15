import { inject, Injectable } from '@angular/core';
import { Selector, Store } from '@ngrx/store';
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
import { selectSectionFeatureState } from '../../features/section/store/section.selectors';
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
 * Single source of truth for the NgRx selectors that make up the snapshot.
 * Both _getNgRxDataSync() and getStateSnapshotAsync() iterate this list,
 * so adding a new synced model requires updating it in exactly one place.
 *
 * The order is load-bearing for _getNgRxDataSync — each entry's key
 * determines where the value lands in the returned AppStateSnapshot.
 * The first entry must be `task` because it receives special treatment
 * (selectedTaskId / currentTaskId clearing).
 */
type NgRxModelKey = keyof Omit<AppStateSnapshot, 'archiveYoung' | 'archiveOld'>;

const SNAPSHOT_SELECTORS: readonly {
  key: NgRxModelKey;
  selector: Selector<object, unknown>;
}[] = [
  { key: 'task', selector: selectTaskFeatureState },
  { key: 'project', selector: selectProjectFeatureState },
  { key: 'tag', selector: selectTagFeatureState },
  { key: 'globalConfig', selector: selectConfigFeatureState },
  { key: 'note', selector: selectNoteFeatureState },
  { key: 'issueProvider', selector: selectIssueProviderState },
  { key: 'planner', selector: selectPlannerState },
  { key: 'boards', selector: selectBoardsState },
  { key: 'metric', selector: selectMetricFeatureState },
  { key: 'simpleCounter', selector: selectSimpleCounterFeatureState },
  { key: 'taskRepeatCfg', selector: selectTaskRepeatCfgFeatureState },
  { key: 'menuTree', selector: selectMenuTreeState },
  { key: 'timeTracking', selector: selectTimeTrackingState },
  { key: 'pluginUserData', selector: selectPluginUserDataFeatureState },
  { key: 'pluginMetadata', selector: selectPluginMetadataFeatureState },
  { key: 'reminders', selector: selectReminderFeatureState },
  { key: 'section', selector: selectSectionFeatureState },
] as const;

/**
 * Service that reads complete application state from NgRx store and IndexedDB.
 *
 * Most models are persisted via OperationLogEffects to SUP_OPS IndexedDB, so we read from NgRx.
 * Archives (archiveYoung, archiveOld) are read from SUP_OPS via ArchiveDbAdapter.
 *
 * ## ⚠️ Returned objects share references with live NgRx state — DO NOT MUTATE
 * Only the top-level `task` slice is shallow-copied; `project`, `tag`,
 * `taskRepeatCfg`, every `entities` map, and all entity objects are the same
 * references held by the store. NgRx runtime freezing is OFF in production
 * (`src/main.ts`), so mutating a returned object silently corrupts the store
 * (memoized selectors won't recompute; a throw before the next `loadAllData`
 * leaves the damage in place with no op-log capture). Any consumer that needs
 * to modify the snapshot must `structuredClone()` it first — see the #8333
 * regression in `dataRepair()` (`op-log/validation/data-repair.ts`).
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
   *
   * ⚠️ Returns live store references — never mutate (clone first). See class doc.
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
   *
   * ⚠️ Returns live store references — never mutate (clone first). See class doc.
   */
  async getStateSnapshotAsync(): Promise<AppStateSnapshot> {
    const [archiveYoung, archiveOld] = await Promise.all([
      this._loadArchive('archiveYoung'),
      this._loadArchive('archiveOld'),
    ]);

    const ngRxValues = await firstValueFrom(
      combineLatest(SNAPSHOT_SELECTORS.map((s) => this._store.select(s.selector))).pipe(
        first(),
      ),
    );

    const result: Partial<Record<NgRxModelKey, unknown>> = {};
    for (let i = 0; i < SNAPSHOT_SELECTORS.length; i++) {
      result[SNAPSHOT_SELECTORS[i].key] = ngRxValues[i];
    }

    return {
      ...this._normalizeNgRxData(result),
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
    const result: Partial<Record<NgRxModelKey, unknown>> = {};

    // Subscribe synchronously to get current values
    for (const { key, selector } of SNAPSHOT_SELECTORS) {
      this._store
        .select(selector)
        .pipe(first())
        .subscribe((v) => (result[key] = v));
    }

    return this._normalizeNgRxData(result);
  }

  /**
   * Applies the task-specific normalization (clear selectedTaskId/currentTaskId
   * in production) and returns the result typed as AppStateSnapshot minus archives.
   * Shared by both the sync and async snapshot paths.
   */
  private _normalizeNgRxData(
    data: Partial<Record<NgRxModelKey, unknown>>,
  ): Omit<AppStateSnapshot, 'archiveYoung' | 'archiveOld'> {
    const task = data['task'] as object;
    return {
      ...data,
      task: {
        ...task,
        selectedTaskId: environment.production
          ? null
          : ((task as { selectedTaskId?: string | null })?.selectedTaskId ?? null),
        currentTaskId: null,
      },
    } as Omit<AppStateSnapshot, 'archiveYoung' | 'archiveOld'>;
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
