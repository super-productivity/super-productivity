import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';

import { distinctUntilChanged, map, skip } from 'rxjs/operators';
import { AppStateActions } from './app-state.actions';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../core/date/date.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { waitForSyncWindow } from '../../util/wait-for-sync-window.operator';

@Injectable()
export class AppStateEffects {
  private _globalTimeTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dateService = inject(DateService);
  private _hydrationState = inject(HydrationStateService);

  // Dispatches setTodayString whenever the date changes (timer/focus/visibility).
  // skip(1): The initial startWith() emission from todayDateStr$ fires before config loads,
  // so startOfNextDayDiffMs would be 0. setStartOfNextDayDiffOnLoad handles the initial dispatch.
  // Wait out the sync window instead of dropping the emission: todayDateStr$ emits a new
  // date once per day, so a dropped one leaves todayStr stale until restart (#10291).
  setTodayStr$ = createEffect(() => {
    return this._globalTimeTrackingIntervalService.todayDateStr$.pipe(
      skip(1),
      distinctUntilChanged(),
      waitForSyncWindow(this._hydrationState, 'AppStateEffects:setTodayStr$'),
      map((todayStr) =>
        AppStateActions.setTodayString({
          todayStr,
          startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
        }),
      ),
    );
  });
}
