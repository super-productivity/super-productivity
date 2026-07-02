import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { createSelector, Store } from '@ngrx/store';
import { filter, scan, switchMap, take } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { getMsSinceLastCriticalError } from '../../util/critical-error-signal';
import { IS_ANDROID_WEB_VIEW, IS_F_DROID_APP } from '../../util/is-android-web-view';
import { IS_IOS_NATIVE } from '../../util/is-native-platform';
import { androidInterface } from '../android/android-interface';
import { Log } from '../../core/log';
import {
  selectTodayTaskIds,
  selectUndoneTodayTaskIds,
} from '../work-context/store/work-context.selectors';
import { DialogPleaseRateComponent } from './dialog-please-rate.component';
import {
  applyRateDialogResult,
  isProgressWin,
  loadRateDialogState,
  saveRateDialogState,
  shouldShowRateDialog,
} from './rate-dialog-state';
import { StoreReview } from './store-review';

// Single composed selector so `done`/`total` are always read from the SAME
// settled state. Deriving them from two separate store.select subscriptions
// (combineLatest) glitches: a task-add emits new total with a stale undone
// count, transiently inflating `done` and firing the prompt on a non-completion.
export const selectTodayProgress = createSelector(
  selectTodayTaskIds,
  selectUndoneTodayTaskIds,
  (allIds, undoneIds) => ({
    done: allIds.length - undoneIds.length,
    total: allIds.length,
  }),
);

/**
 * Owns the "please rate" prompt: when to ask (cadence) and when within a session
 * to actually show it. We never prompt on cold launch — both stores recommend
 * asking after a positive moment — so an eligible session is only *armed*, and
 * the prompt fires on the first productive "win" (see isProgressWin). The prompt
 * itself is the native review card on Play/iOS, or the dialog elsewhere.
 */
@Injectable({ providedIn: 'root' })
export class RatePromptService {
  private readonly _matDialog = inject(MatDialog);
  private readonly _store = inject(Store);
  private readonly _dataInitStateService = inject(DataInitStateService);
  private readonly _destroyRef = inject(DestroyRef);

  private _appStarts = 0;
  private _isArmed = false;

  /** Call once during deferred startup. */
  init(): void {
    const lastStartDay = localStorage.getItem(LS.APP_START_COUNT_LAST_START_DAY);
    const todayStr = getDbDateStr();
    let appStarts = +(localStorage.getItem(LS.APP_START_COUNT) || 0);
    if (lastStartDay !== todayStr) {
      appStarts += 1;
      localStorage.setItem(LS.APP_START_COUNT, appStarts.toString());
      localStorage.setItem(LS.APP_START_COUNT_LAST_START_DAY, todayStr);
    }
    this._appStarts = appStarts;

    const state = loadRateDialogState();
    if (!shouldShowRateDialog(state, appStarts, getMsSinceLastCriticalError())) {
      return;
    }
    this._armForWin();
  }

  private _armForWin(): void {
    this._isArmed = true;

    this._dataInitStateService.isAllDataLoadedInitially$
      .pipe(
        // Sample the baseline only once data has hydrated — otherwise the empty
        // pre-hydration state is captured as the baseline and the first loaded
        // emission looks like an in-session win (a disguised cold-launch prompt).
        filter((isLoaded) => isLoaded),
        take(1),
        switchMap(() => this._store.select(selectTodayProgress)),
        // First (settled) emission is the session baseline; only fire on a later
        // increase, i.e. a real completion this session.
        scan(
          (acc, cur, index) => ({
            ...cur,
            baseline: index === 0 ? cur.done : acc.baseline,
          }),
          { done: 0, total: 0, baseline: 0 },
        ),
        filter(
          ({ done, total, baseline }) => done > baseline && isProgressWin(done, total),
        ),
        take(1),
        takeUntilDestroyed(this._destroyRef),
      )
      // _promptNow re-checks _isArmed, so a stray second init() can't double-prompt.
      .subscribe(() => this._promptNow());
  }

  private _promptNow(): void {
    if (!this._isArmed) {
      return;
    }
    this._isArmed = false;

    const state = loadRateDialogState();
    // Defensive: opt-out could have been set through another path since arming.
    if (state.permanentOptOut) {
      return;
    }

    // Play-flavor Android: native Play In-App Review card. Play decides
    // whether/when it shows and returns no result, so just advance the cadence.
    if (
      IS_ANDROID_WEB_VIEW &&
      !IS_F_DROID_APP &&
      typeof androidInterface.requestReview === 'function'
    ) {
      androidInterface.requestReview();
      saveRateDialogState(applyRateDialogResult(state, 'later', this._appStarts));
      return;
    }

    // iOS: native App Store review prompt (SKStoreReviewController).
    if (IS_IOS_NATIVE) {
      void StoreReview.requestReview().catch((e) =>
        Log.err({ id: 'rate-store-review-ios', error: (e as Error)?.message }),
      );
      saveRateDialogState(applyRateDialogResult(state, 'later', this._appStarts));
      return;
    }

    // Web / Electron / F-Droid: the neutral dialog.
    this._matDialog
      .open(DialogPleaseRateComponent)
      .afterClosed()
      .subscribe((result) => {
        saveRateDialogState(
          applyRateDialogResult(loadRateDialogState(), result ?? null, this._appStarts),
        );
      });
  }
}
