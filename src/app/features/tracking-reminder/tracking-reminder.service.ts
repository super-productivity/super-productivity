import { Injectable, inject } from '@angular/core';
import { IdleService } from '../idle/idle.service';
import { TaskService } from '../tasks/task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { combineLatest, EMPTY, merge, Observable, of, Subject } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  shareReplay,
  switchMap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import { realTimer$ } from '../../util/real-timer';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { msToString } from '../../ui/duration/ms-to-string.pipe';
import { MatDialog } from '@angular/material/dialog';
import { DialogTrackingReminderComponent } from './dialog-tracking-reminder/dialog-tracking-reminder.component';
import { Task } from '../tasks/task.model';
import { T } from '../../t.const';
import { TranslateService } from '@ngx-translate/core';
import { TimeTrackingConfig } from '../config/global-config.model';
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';
import { DateService } from '../../core/date/date.service';
import { TakeABreakService } from '../take-a-break/take-a-break.service';
import { NotifyService } from '../../core/notify/notify.service';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import { playSound } from '../../util/play-sound';
import { Store } from '@ngrx/store';
import {
  selectCurrentScreen,
  selectTimer,
} from '../focus-mode/store/focus-mode.selectors';
import { selectIsFocusModeEnabled } from '../config/store/global-config.reducer';
import { FocusScreen } from '../focus-mode/focus-mode.model';

const DESKTOP_NOTIFICATION_THROTTLE = 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class TrackingReminderService {
  private _idleService = inject(IdleService);
  private _taskService = inject(TaskService);
  private _globalConfigService = inject(GlobalConfigService);
  private _bannerService = inject(BannerService);
  private _matDialog = inject(MatDialog);
  private _translateService = inject(TranslateService);
  private _dateService = inject(DateService);
  private _takeABreakService = inject(TakeABreakService);
  private _notifyService = inject(NotifyService);
  private _uiHelperService = inject(UiHelperService);
  private _store = inject(Store);

  _cfg$: Observable<TimeTrackingConfig> = this._globalConfigService.cfg$.pipe(
    map((cfg) => cfg?.timeTracking),
  );

  _counter$: Observable<number> = realTimer$(1000);

  _manualReset$: Subject<void> = new Subject();

  _resetableCounter$: Observable<number> = merge(of('INITIAL'), this._manualReset$).pipe(
    switchMap(() => this._counter$),
  );

  _hideTrigger$: Observable<any> = merge(
    this._taskService.currentTaskId$.pipe(filter((currentId) => !!currentId)),
    this._idleService.isIdle$.pipe(filter((isIdle) => isIdle)),
  );

  private _isFocusModeActive$: Observable<boolean> = combineLatest([
    this._store.select(selectIsFocusModeEnabled),
    this._store.select(selectTimer),
    this._store.select(selectCurrentScreen),
  ]).pipe(
    map(
      ([isEnabled, timer, screen]) =>
        isEnabled && (timer.purpose !== null || screen === FocusScreen.SessionDone),
    ),
    distinctUntilChanged(),
  );

  remindCounter$: Observable<number> = this._cfg$.pipe(
    switchMap((cfg) =>
      !cfg?.isTrackingReminderEnabled ||
      (!cfg.isTrackingReminderShowOnMobile && IS_TOUCH_ONLY)
        ? EMPTY
        : combineLatest([
            this._taskService.currentTaskId$,
            this._idleService.isIdle$,
            this._isFocusModeActive$,
          ]).pipe(
            map(
              ([currentTaskId, isIdle, isFocusModeActive]) =>
                !currentTaskId && !isIdle && !isFocusModeActive,
            ),
            distinctUntilChanged(),
            switchMap((isEnabled) => (isEnabled ? this._resetableCounter$ : of(0))),
            filter((time) => time > cfg.trackingReminderMinTime),
          ),
    ),
    shareReplay(),
  );

  // New throttled notification stream
  private _throttledNotificationTrigger$ = new Subject<string>();

  init(): void {
    this.remindCounter$.subscribe((count) => {
      this._triggerBanner(count);
    });

    this._hideTrigger$.subscribe((v) => {
      this._hideBanner();
    });

    // Set up throttled notification handling
    this._throttledNotificationTrigger$
      .pipe(
        throttleTime(DESKTOP_NOTIFICATION_THROTTLE),
        // Get all needed config in one go
        withLatestFrom(
          this._globalConfigService.sound$,
          this._globalConfigService.cfg$.pipe(map((cfg) => cfg.timeTracking)),
        ),
      )
      .subscribe(([durationStr, soundCfg, timeTrackingCfg]) => {
        this._showNotification(durationStr);

        // Play sound if configured
        if (soundCfg.trackTimeSound) {
          playSound(soundCfg.trackTimeSound as string);
        }

        // Focus window if enabled
        if (timeTrackingCfg.isTrackingReminderFocusWindow) {
          this._focusWindow();
        }
      });
  }

  private _hideBanner(): void {
    this._bannerService.dismiss(BannerId.StartTrackingReminder);
  }

  private _triggerBanner(duration: number): void {
    // don't update if this or other dialogs are open
    if (this._matDialog.openDialogs.length !== 0) {
      return;
    }

    this._bannerService.open({
      id: BannerId.StartTrackingReminder,
      ico: 'timer',
      msg: T.F.TIME_TRACKING.B_TTR.MSG_WITHOUT_TIME,
      timer$: this.remindCounter$,
      action: {
        label: T.F.TIME_TRACKING.B_TTR.ADD_TO_TASK,
        fn: () => this._openDialog(),
      },
      action2: {
        label: T.G.DISMISS,
        fn: () => this._dismissBanner(),
      },
    });

    // Handle desktop notification if enabled
    this._globalConfigService.cfg$
      .pipe(
        filter((cfg) => !!cfg),
        first(),
      )
      .subscribe((cfg) => {
        // Show desktop notification if enabled
        if (cfg.timeTracking.isTrackingReminderNotify) {
          // Instead of showing directly, queue it through the throttled subject
          const durationStr = msToString(duration);
          this._throttledNotificationTrigger$.next(durationStr);
        }
      });
  }

  private _openDialog(): void {
    this._matDialog
      .open(DialogTrackingReminderComponent, {
        data: {
          disableClose: true,
          remindCounter$: this.remindCounter$,
        },
      })
      .afterClosed()
      .pipe(withLatestFrom(this.remindCounter$))
      .subscribe(
        async ([{ task } = { task: undefined }, remindCounter]: [
          { task: Task | string | undefined },
          number,
        ]): Promise<void> => {
          this._manualReset$.next();
          const timeSpent = remindCounter;

          if (task) {
            this._takeABreakService.otherNoBreakTIme$.next(timeSpent);
            if (typeof task === 'string') {
              const currId = this._taskService.add(task, false, {
                timeSpent,
                timeSpentOnDay: {
                  [this._dateService.todayStr()]: timeSpent,
                },
              });
              this._taskService.setCurrentId(currId);
            } else {
              this._taskService.addTimeSpentAndSync(task, timeSpent);
              this._taskService.setCurrentId(task.id);
            }
          }
          this._dismissBanner();
        },
      );
  }

  private _dismissBanner(): void {
    this._bannerService.dismiss(BannerId.StartTrackingReminder);
    this._manualReset$.next();
  }

  private _showNotification(durationStr: string): void {
    this._notifyService.notify({
      title: this._translateService.instant(
        T.F.TIME_TRACKING.D_TRACKING_REMINDER.NOTIFICATION_TITLE,
      ),
      body: this._translateService.instant(T.F.TIME_TRACKING.B_TTR.MSG, {
        time: durationStr,
      }),
      requireInteraction: true,
    });
  }

  private _focusWindow(): void {
    this._uiHelperService.focusAppAfterNotification();
  }
}
