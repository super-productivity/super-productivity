import { inject, Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';
import { mapTo, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { allDataWasLoaded } from '../../root-store/meta/all-data-was-loaded.actions';
import { DataInitStateService } from './data-init-state.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { OperationLogHydratorService } from '../../op-log/persistence/operation-log-hydrator.service';
import { OpLog } from '../log';

@Injectable({ providedIn: 'root' })
export class DataInitService {
  private _store$ = inject<Store<any>>(Store);
  private _dataInitStateService = inject(DataInitStateService);
  private _userProfileService = inject(UserProfileService);
  private _operationLogHydratorService = inject(OperationLogHydratorService);

  private _isAllDataLoadedInitially$: Observable<boolean> = from(this.reInit()).pipe(
    mapTo(true),
  );

  constructor() {
    // TODO better construction than this
    this._isAllDataLoadedInitially$.pipe(take(1)).subscribe({
      next: (v) => {
        // here because to avoid circular dependencies
        this._store$.dispatch(allDataWasLoaded());
        this._dataInitStateService._neverUpdateOutsideDataInitService$.next(v);
      },
      error: (err) => {
        // Snack notification is already shown by OperationLogHydratorService
        OpLog.err('DataInitService: Failed to initialize app data', err);
      },
    });
  }

  // NOTE: it's important to remember that this doesn't mean that no changes are occurring any more
  // because the data load is triggered, but not necessarily already reflected inside the store
  async reInit(): Promise<void> {
    // localStorage check
    // This check happens before ANY profile initialization code runs
    const isProfilesEnabled =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('sp_user_profiles_enabled') === 'true';

    if (isProfilesEnabled) {
      // Only initialize profile system if explicitly enabled
      await this._userProfileService.initialize();
    }

    // Hydrate from Operation Log (which handles migration from legacy if needed)
    await this._operationLogHydratorService.hydrateStore();
  }

  /**
   * Re-initialize the app after a remote sync download.
   * This uses hydrateFromRemoteSync() which:
   * 1. Uses the downloaded mainModelData (passed from sync service)
   * 2. Persists it to SUP_OPS as a SYNC_IMPORT operation
   * 3. Creates a snapshot for crash safety
   * 4. Updates NgRx with the synced data
   *
   * @param downloadedMainModelData - The main model data from the remote meta file.
   *   Entity models are not stored in IndexedDB, so this must be passed explicitly.
   */
  async reInitFromRemoteSync(
    downloadedMainModelData?: Record<string, unknown>,
  ): Promise<void> {
    await this._operationLogHydratorService.hydrateFromRemoteSync(
      downloadedMainModelData,
    );
  }
}
