import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import {
  delay,
  distinctUntilChanged,
  filter,
  scan,
  switchMap,
  take,
} from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { getMsSinceLastCriticalError } from '../../util/critical-error-signal';
import { IS_ANDROID_WEB_VIEW, IS_F_DROID_APP } from '../../util/is-android-web-view';
import { IS_IOS_NATIVE } from '../../util/is-native-platform';
import { androidInterface } from '../android/android-interface';
import { Log } from '../../core/log';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { T } from '../../t.const';
import { selectTodayProgress } from '../work-context/store/work-context.selectors';
import { DialogPleaseRateComponent } from './dialog-please-rate.component';
import {
  applyRateDialogResult,
  isProgressWin,
  loadRateDialogState,
  saveRateDialogState,
  shouldShowRateDialog,
} from './rate-dialog-state';
import { StoreReview } from './store-review';

// Don't fire the instant a task is checked off — let the completion land, then
// prompt a beat later so it reads as "nice session" rather than a reflex popup.
// Exported for the spec (which has to tick past it).
export const WIN_PROMPT_DELAY_MS = 3000;

/**
 * Owns the "please rate" prompt: when to ask (cadence) and when within a session
 * to actually show it. We never prompt on cold launch — both stores recommend
 * asking after a positive moment — so an eligible session is only *armed*, and
 * the prompt fires a few seconds after the first productive "win" (see
 * isProgressWin). The prompt is the native review card on Play/iOS, and a calm,
 * non-modal banner elsewhere (the banner opens the full rate/feedback dialog on
 * request, so we never shove a modal in the user's face mid-flow).
 */
@Injectable({ providedIn: 'root' })
export class RatePromptService {
  private readonly _matDialog = inject(MatDialog);
  private readonly _store = inject(Store);
  private readonly _dataInitStateService = inject(DataInitStateService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _bannerService = inject(BannerService);

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
    // Idempotent: a second init()/arm must not spin up a second long-lived
    // store subscription (the _isArmed check in _promptNow only guards the
    // prompt, not the subscription).
    if (this._isArmed) {
      return;
    }
    this._isArmed = true;

    this._dataInitStateService.isAllDataLoadedInitially$
      .pipe(
        // Sample the baseline only once data has hydrated — otherwise the empty
        // pre-hydration state is captured as the baseline and the first loaded
        // emission looks like an in-session win (a disguised cold-launch prompt).
        filter((isLoaded) => isLoaded),
        take(1),
        switchMap(() => this._store.select(selectTodayProgress)),
        // selectTodayProgress recomputes on unrelated task changes (e.g. the 1s
        // time-tracking tick emits a new {done,total} object with identical
        // numbers); collapse those so the scan/filter only run on a real change.
        distinctUntilChanged((a, b) => a.done === b.done && a.total === b.total),
        // First (settled) emission is the session baseline; only fire on a later
        // increase, i.e. a real completion this session. NOTE: the baseline is a
        // fixed count, so a session left open past midnight keeps yesterday's
        // baseline — this errs toward under-prompting (new day starts near 0
        // done), never toward nagging, so it's acceptable.
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
        // Small beat after the win so the prompt doesn't fire on the same tick as
        // the completion tap.
        delay(WIN_PROMPT_DELAY_MS),
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
    // Re-check eligibility, not just opt-out: a crash or data-damage recorded
    // *after* arming (GlobalErrorHandler / state-validation this session) must
    // still suppress the prompt, so we never ask for a review right after the
    // user hit a failure. Inputs are re-read fresh here.
    if (!shouldShowRateDialog(state, this._appStarts, getMsSinceLastCriticalError())) {
      return;
    }

    // Play-flavor Android: native Play In-App Review card. Play decides
    // whether/when it shows and returns no result, so we just advance the
    // cadence. Play may quota-suppress the card silently — with the recurring
    // cadence that's only a deferral to the next window, not a lost lifetime
    // prompt, and Play throttles duplicate requests itself.
    if (
      IS_ANDROID_WEB_VIEW &&
      !IS_F_DROID_APP &&
      typeof androidInterface.requestReview === 'function'
    ) {
      androidInterface.requestReview();
      saveRateDialogState(applyRateDialogResult(state, 'later', this._appStarts));
      return;
    }

    // iOS: native App Store review prompt (SKStoreReviewController). Advance the
    // cadence only once the request actually resolves — if the plugin rejects
    // (e.g. no active window scene), leave eligibility intact so a later session
    // can retry rather than silently burning this cadence slot.
    if (IS_IOS_NATIVE) {
      void StoreReview.requestReview()
        .then(() =>
          saveRateDialogState(
            applyRateDialogResult(loadRateDialogState(), 'later', this._appStarts),
          ),
        )
        .catch((e) =>
          Log.err({ id: 'rate-store-review-ios', error: (e as Error)?.message }),
        );
      return;
    }

    // Web / Electron / F-Droid: a calm, non-modal banner instead of a blocking
    // dialog (honours "flow, not friction"). Merely showing it counts as this
    // tier's prompt, so record 'later' now; the user opens the full dialog only
    // if they choose to, and that dialog's result upgrades the state on close.
    saveRateDialogState(applyRateDialogResult(state, 'later', this._appStarts));
    this._bannerService.open({
      id: BannerId.RatePrompt,
      ico: 'star',
      msg: T.F.D_RATE.TITLE,
      action: {
        label: T.F.D_RATE.BANNER_ACTION,
        fn: () => this._openRateDialog(),
      },
    });
  }

  private _openRateDialog(): void {
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
