import { Injectable, inject } from '@angular/core';
import { TaskService } from '../tasks/task.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { EMPTY, from, merge, Observable, of, Subject, timer } from 'rxjs';
import {
  delay,
  distinctUntilChanged,
  filter,
  map,
  mapTo,
  scan,
  shareReplay,
  startWith,
  switchMap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import { GlobalConfigService } from '../config/global-config.service';
import { msToString } from '../../ui/duration/ms-to-string.pipe';
import { IdleService } from '../idle/idle.service';
import { IS_ELECTRON } from '../../app.constants';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { GlobalConfigState, TakeABreakConfig } from '../config/global-config.model';
import { T } from '../../t.const';
import { NotifyService } from '../../core/notify/notify.service';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import { Tick } from '../../core/global-tracking-interval/tick.model';
import { ofType } from '@ngrx/effects';
import { idleDialogResult } from '../idle/store/idle.actions';
import { playSound } from '../../util/play-sound';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { SnackService } from '../../core/snack/snack.service';

const BREAK_TRIGGER_DURATION = 10 * 60 * 1000;
const PING_UPDATE_BANNER_INTERVAL = 60 * 1000;
const DESKTOP_NOTIFICATION_THROTTLE = 60 * 1000;
const LOCK_SCREEN_DELAY = 30 * 1000;
const FULLSCREEN_BLOCKER_DELAY = 30 * 1000;

// required because typescript freaks out
const reduceBreak = (acc: number, tick: Tick): number => {
  return acc + tick.duration;
};

const BANNER_ID: BannerId = BannerId.TakeABreak;

@Injectable({
  providedIn: 'root',
})
export class TakeABreakService {
  private _taskService = inject(TaskService);
  private _timeTrackingService = inject(GlobalTrackingIntervalService);
  private _idleService = inject(IdleService);
  private _actions$ = inject(LOCAL_ACTIONS);
  private _configService = inject(GlobalConfigService);
  private _notifyService = inject(NotifyService);
  private _bannerService = inject(BannerService);
  private _uiHelperService = inject(UiHelperService);
  private _snackService = inject(SnackService);

  otherNoBreakTIme$ = new Subject<number>();

  private _timeWithNoCurrentTask$: Observable<number> =
    this._taskService.currentTaskId$.pipe(
      switchMap((currentId) => {
        return currentId
          ? from([0])
          : this._timeTrackingService.tick$.pipe(scan(reduceBreak, 0));
      }),
      shareReplay(1),
    );

  // NOTE: edge-triggered on purpose, and this changes semantics, not just cost.
  //
  // Cost: _timeWithNoCurrentTask$ grows monotonically while nothing is tracked,
  // so a plain filter re-fired on every 1s tick for as long as the app stayed
  // open — and timeWorkingWithoutABreak$ is bound via `| async` in the work
  // view, so each one cost a change-detection pass.
  //
  // Semantics: the reset now fires once per untracked stretch instead of pinning
  // the counter to 0 for its whole duration, so time added LATER in the same
  // stretch survives. That is the point — the idle dialog deselects the task
  // (idle.effects.ts), so with a level trigger the dialog's "reset break timer"
  // checkbox was inert for any absence over BREAK_TRIGGER_DURATION: unchecking
  // it kept the tracked time for one tick before the next tick wiped it again.
  private _triggerSimpleBreakReset$: Observable<unknown> =
    this._timeWithNoCurrentTask$.pipe(
      map((timeWithNoTask) => timeWithNoTask > BREAK_TRIGGER_DURATION),
      distinctUntilChanged(),
      filter(Boolean),
    );

  private _tick$: Observable<number> = merge(
    this._timeTrackingService.tick$.pipe(
      map((tick) => tick.duration),
      filter(() => !!this._taskService.currentTaskId()),
    ),
    // NOTE: idle-dialog results deliberately don't feed the counter (see #9352);
    // the dialog's reset checkbox goes through _triggerIdleDialogReset$ instead
    this.otherNoBreakTIme$,
  ).pipe(
    // Additions only. The seedless scan below treats any value <= 0 as a reset,
    // so an out-of-band non-positive value used to zero the counter WITHOUT
    // tearing the reminder down, leaving the banner claiming hours of work over
    // a counter reading 0. That is not hypothetical: Android passes
    // `cap = Math.max(0, timer.duration - timer.elapsed)` to
    // `triggerWakeUpTick`, which is exactly 0 whenever a focus session sits at
    // or over its duration (android-focus-mode.effects.ts), and
    // `consumeCurrentTick()` is unclamped, so a backwards clock step goes
    // negative. Resetting is `_triggerReset$`'s job alone.
    filter((duration) => duration > 0),
  );

  // the dialog checkbox is the single source of truth for resetting; it
  // auto-defaults to checked when a break is tracked, so an unchecked value
  // means the user explicitly opted out of the reset
  private _triggerIdleDialogReset$: Observable<unknown> = this._actions$.pipe(
    ofType(idleDialogResult),
    filter(({ isResetBreakTimer }) => isResetBreakTimer),
  );

  private _triggerSnooze$: Subject<number> = new Subject();
  private _snoozeActive$: Observable<boolean> = this._triggerSnooze$.pipe(
    startWith(false),
    switchMap((val: boolean | number) => {
      if (val === false) {
        return [false];
      } else {
        return timer(+val).pipe(mapTo(false), startWith(true));
      }
    }),
  );

  // NOTE: this used to be skipped whenever idle tracking was on, on the
  // assumption that the idle path would reset the timer instead. It hasn't:
  // the action it waited for lost its last dispatcher in v11.1.0, so for every
  // Electron user (idle tracking defaults to on) the automatic reset was dead
  // and only the idle dialog's checkbox could clear the timer. See #9305.
  private _triggerProgrammaticReset$: Observable<unknown> =
    this._triggerSimpleBreakReset$;

  private _triggerManualReset$: Subject<number> = new Subject<number>();

  // Every reset path must land here: _triggerReset$ both zeroes the counter and
  // drives the reminder teardown below, so a reset routed around it (as the idle
  // dialog and focus-mode breaks used to be) leaves a stale banner up and leaves
  // the lock-screen / fullscreen-blocker subjects latched at `true`, silently
  // disabling both for the rest of the session. See #9305.
  //
  // Subscribed twice (the teardown below, and timeWorkingWithoutABreak$) and
  // deliberately left cold: _timeWithNoCurrentTask$ is shareReplay(1), so the
  // second subscriber is handed exactly the last value the first one saw and the
  // two distinctUntilChanged instances cannot diverge. Do not "fix" this with
  // share() — that would trade a state argument that holds unconditionally for
  // one that depends on nothing emitting between the two subscribe calls.
  private _triggerReset$: Observable<number> = merge(
    this._triggerProgrammaticReset$,
    this._triggerManualReset$,
    this._triggerIdleDialogReset$,
  ).pipe(mapTo(0));

  timeWorkingWithoutABreak$: Observable<number> = merge(
    this._tick$,
    this._triggerReset$,
    // of(9999999).pipe(delay(4000)),
  ).pipe(
    scan((acc, value) => {
      return value > 0 ? acc + value : value;
    }),
    shareReplay(1),
  );

  private _triggerLockScreenCounter$: Subject<boolean> = new Subject();
  // NOTE: no throttle here or on the fullscreen blocker below — the real
  // spacing between triggers is distinctUntilChanged() (the subject only
  // re-fires after a reset sets it back to false) plus the break-reminder
  // cadence feeding it.
  private _triggerLockScreenDelayed$: Observable<unknown | never> = IS_ELECTRON
    ? this._triggerLockScreenCounter$.pipe(
        distinctUntilChanged(),
        switchMap((v) => (!!v ? of(v).pipe(delay(LOCK_SCREEN_DELAY)) : EMPTY)),
      )
    : EMPTY;

  private _triggerFullscreenBlocker$: Subject<boolean> = new Subject();
  private _triggerFullscreenBlockerDelayed$: Observable<unknown | never> = IS_ELECTRON
    ? this._triggerFullscreenBlocker$.pipe(
        distinctUntilChanged(),
        switchMap((v) => (!!v ? of(v).pipe(delay(FULLSCREEN_BLOCKER_DELAY)) : EMPTY)),
      )
    : EMPTY;

  private _triggerBanner$: Observable<[number, GlobalConfigState, boolean, boolean]> =
    this.timeWorkingWithoutABreak$.pipe(
      withLatestFrom(
        this._configService.cfg$,
        this._idleService.isIdle$,
        this._snoozeActive$,
      ),
      filter(
        ([timeWithoutBreak, cfg, isIdle, isSnoozeActive]: [
          number,
          GlobalConfigState,
          boolean,
          boolean,
        ]): boolean =>
          cfg &&
          cfg.takeABreak &&
          cfg.takeABreak.isTakeABreakEnabled &&
          !isSnoozeActive &&
          timeWithoutBreak > cfg.takeABreak.takeABreakMinWorkingTime &&
          // we don't wanna show if idle to avoid conflicts with the idle modal
          (!isIdle || !cfg.idle.isEnableIdleTimeTracking),
      ),
      // throttleTime(5 * 1000),
      throttleTime(PING_UPDATE_BANNER_INTERVAL),
    );

  private _triggerDesktopNotification$: Observable<
    [number, GlobalConfigState, boolean, boolean]
  > = this._triggerBanner$.pipe(throttleTime(DESKTOP_NOTIFICATION_THROTTLE));

  constructor() {
    // NOTE: deliberately not gated on isTakeABreakEnabled. Dismissing a banner
    // that cannot be open and un-latching subjects that cannot be `true` are
    // both no-ops, whereas skipping the teardown when the feature is toggled
    // off mid-session strands those subjects at `true` for good — the exact
    // state this is here to prevent.
    this._triggerReset$.subscribe(() => {
      this._triggerLockScreenCounter$.next(false);
      this._triggerFullscreenBlocker$.next(false);
      this._bannerService.dismiss(BANNER_ID);
    });

    if (IS_ELECTRON) {
      this._triggerLockScreenDelayed$.subscribe(() => {
        window.ea.lockScreen();
      });

      this._triggerFullscreenBlockerDelayed$
        .pipe(
          withLatestFrom(this._configService.takeABreak$, this.timeWorkingWithoutABreak$),
        )
        .subscribe(([, takeABreakCfg, timeWorkingWithoutABreak]) => {
          const msg = this._createMessage(timeWorkingWithoutABreak, takeABreakCfg);
          window.ea.showFullScreenBlocker({
            msg,
            takeABreakCfg,
          });
        });
    }

    this._triggerDesktopNotification$.subscribe(([timeWithoutBreak, cfg]) => {
      const msg = this._createMessage(timeWithoutBreak, cfg.takeABreak);
      this._notifyService.notifyDesktop({
        tag: 'TAKE_A_BREAK',
        // Todo: check if applicable
        ...({
          renotify: true,
        } as any),
        title: T.GCF.TAKE_A_BREAK.NOTIFICATION_TITLE,
        body: msg,
      });
    });

    // handle sounds
    this._configService.sound$
      .pipe(
        switchMap((soundCfg) =>
          soundCfg.breakReminderSound
            ? this._triggerBanner$.pipe(mapTo(soundCfg))
            : EMPTY,
        ),
      )
      .subscribe((soundCfg) => {
        playSound(soundCfg.breakReminderSound as string);
      });

    this._triggerBanner$.subscribe(([timeWithoutBreak, cfg]) => {
      const msg: string = this._createMessage(timeWithoutBreak, cfg.takeABreak) as string;
      if (IS_ELECTRON && cfg.takeABreak.isLockScreen) {
        this._triggerLockScreenCounter$.next(true);
      }
      if (IS_ELECTRON && cfg.takeABreak.isTimedFullScreenBlocker) {
        this._triggerFullscreenBlocker$.next(true);
      }
      if (IS_ELECTRON && cfg.takeABreak.isFocusWindow) {
        this._uiHelperService.focusAppAfterNotification();
      }

      this._bannerService.open({
        id: BANNER_ID,
        ico: 'free_breakfast',
        msg,
        translateParams: {
          time: msToString(cfg.takeABreak.takeABreakSnoozeTime),
        },
        action: {
          // Not "Start break": this reminder has no break timer/screen, the
          // button just pauses tracking — so label it for what it does.
          label: T.F.TIME_TRACKING.B.PAUSE_AND_BREAK,
          fn: () => this.startBreak(),
        },
        action2: {
          label: T.F.TIME_TRACKING.B.SNOOZE,
          fn: () => this.snooze(cfg.takeABreak.takeABreakSnoozeTime),
        },
        img:
          // random image
          cfg.takeABreak.motivationalImgs.length
            ? cfg.takeABreak.motivationalImgs[
                Math.floor(Math.random() * cfg.takeABreak.motivationalImgs.length)
              ] || undefined
            : undefined,
      });
    });
  }

  snooze(snoozeTime: number = 15 * 60 * 1000): void {
    this._triggerSnooze$.next(snoozeTime);
    this._triggerLockScreenCounter$.next(false);
    this._triggerFullscreenBlocker$.next(false);
  }

  resetTimer(): void {
    this._triggerManualReset$.next(0);
  }

  startBreak(): void {
    // This reminder isn't a timed-break feature: it just pauses tracking so the
    // rest counts as a break, then resets the reminder. Show an encouraging
    // snack so the click clearly does something instead of nothing.
    this._taskService.pauseCurrent();
    this._snackService.open({
      type: 'SUCCESS',
      ico: 'free_breakfast',
      msg: T.F.TIME_TRACKING.B.BREAK_SNACK,
    });
    this.resetTimer();
  }

  private _createMessage(duration: number, cfg: TakeABreakConfig): string | undefined {
    if (cfg && cfg.takeABreakMessage) {
      const durationStr = msToString(duration);
      return cfg.takeABreakMessage.replace(/\$\{duration\}/gi, durationStr);
    }
    return undefined;
  }
}
