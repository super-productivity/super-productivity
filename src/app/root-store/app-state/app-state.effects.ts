import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';

import { distinctUntilChanged, map } from 'rxjs/operators';
import { AppStateActions } from './app-state.actions';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../core/date/date.service';

@Injectable()
export class AppStateEffects {
  private _globalTimeTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dateService = inject(DateService);

  setTodayStr$ = createEffect(() => {
    return this._globalTimeTrackingIntervalService.todayDateStr$.pipe(
      distinctUntilChanged(),
      map((todayStr) =>
        AppStateActions.setTodayString({
          todayStr,
          startOfNextDayDiffMs: this._dateService.startOfNextDayDiff,
        }),
      ),
    );
  });
}
