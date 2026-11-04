import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { BehaviorSubject, Subject } from 'rxjs';
import { AppStateEffects } from './app-state.effects';
import { AppStateActions } from './app-state.actions';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../core/date/date.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';

describe('AppStateEffects', () => {
  let todayDateStr$: Subject<string>;
  let isInSyncWindow$: BehaviorSubject<boolean>;
  let dispatched: Action[];

  beforeEach(() => {
    todayDateStr$ = new Subject<string>();
    isInSyncWindow$ = new BehaviorSubject<boolean>(false);
    dispatched = [];

    TestBed.configureTestingModule({
      providers: [
        AppStateEffects,
        { provide: GlobalTrackingIntervalService, useValue: { todayDateStr$ } },
        {
          provide: DateService,
          useValue: { getStartOfNextDayDiffMs: () => 0 },
        },
        {
          provide: HydrationStateService,
          useValue: {
            isInSyncWindow: () => isInSyncWindow$.value,
            isInSyncWindow$,
          },
        },
      ],
    });

    TestBed.inject(AppStateEffects).setTodayStr$.subscribe((a) => dispatched.push(a));
    todayDateStr$.next('2026-09-26'); // initial emission, skipped by the effect
  });

  it('dispatches setTodayString when the date changes', () => {
    todayDateStr$.next('2026-09-27');

    expect(dispatched).toEqual([
      AppStateActions.setTodayString({
        todayStr: '2026-09-27',
        startOfNextDayDiffMs: 0,
      }),
    ]);
  });

  // #10291: the day change used to be dropped when it landed during a sync,
  // leaving todayStr on the previous day until the app was restarted.
  it('dispatches a date change that happens during a sync once the sync ends', () => {
    isInSyncWindow$.next(true);
    todayDateStr$.next('2026-09-27');
    expect(dispatched).toEqual([]);

    isInSyncWindow$.next(false);

    expect(dispatched).toEqual([
      AppStateActions.setTodayString({
        todayStr: '2026-09-27',
        startOfNextDayDiffMs: 0,
      }),
    ]);
  });
});
