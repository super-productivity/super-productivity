import { inject, Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';
import { mapTo, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { allDataWasLoaded } from '../../root-store/meta/all-data-was-loaded.actions';
import { DataInitStateService } from './data-init-state.service';
import { OperationLogHydratorService } from '../../op-log/persistence/operation-log-hydrator.service';
import { OpLog } from '../log';

@Injectable({ providedIn: 'root' })
export class DataInitService {
  private _store$ = inject<Store<any>>(Store);
  private _dataInitStateService = inject(DataInitStateService);
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
    // Hydrate from Operation Log (which handles migration from legacy if needed)
    await this._operationLogHydratorService.hydrateStore();
  }
}
