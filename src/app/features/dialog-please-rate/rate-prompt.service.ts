import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { combineLatest } from 'rxjs';
import { filter, map, scan, take } from 'rxjs/operators';
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

    combineLatest([
      this._store.select(selectTodayTaskIds),
      this._store.select(selectUndoneTodayTaskIds),
    ])
      .pipe(
        map(([all, undone]) => ({ done: all.length - undone.length, total: all.length })),
        // Treat the first emission as the session baseline so we only fire after
        // an in-session completion — never because the win was already true when
        // the app opened (which would just be a disguised cold-launch prompt).
        scan(
          (acc, cur, index) => ({
            ...cur,
            baseline: index === 0 ? cur.done : acc.baseline,
          }),
          { done: 0, total: 0, baseline: 0 },
        ),
        filter(
          ({ done, total, baseline }) =>
            this._isArmed && done > baseline && isProgressWin(done, total),
        ),
        take(1),
      )
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
