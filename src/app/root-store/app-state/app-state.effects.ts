import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';

import { distinctUntilChanged, filter, map, skip } from 'rxjs/operators';
import { AppStateActions } from './app-state.actions';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../core/date/date.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';

@Injectable()
export class AppStateEffects {
  private _globalTimeTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dateService = inject(DateService);
  private _hydrationState = inject(HydrationStateService);

  // Dispatches setTodayString whenever the date changes (timer/focus/visibility).
  // skip(1): The initial startWith() emission from todayDateStr$ fires before config loads,
  // so startOfNextDayDiffMs would be 0. setStartOfNextDayDiffOnLoad handles the initial dispatch.
  setTodayStr$ = createEffect(() => {
    return this._globalTimeTrackingIntervalService.todayDateStr$.pipe(
      skip(1),
      distinctUntilChanged(),
      filter(() => !this._hydrationState.isApplyingRemoteOps()),
      map((todayStr) =>
        AppStateActions.setTodayString({
          todayStr,
          startOfNextDayDiffMs: this._dateService.startOfNextDayDiff,
        }),
      ),
    );
  });
}
