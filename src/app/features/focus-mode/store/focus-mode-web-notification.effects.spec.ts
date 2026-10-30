import { DOCUMENT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MemoizedSelector } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Subscription } from 'rxjs';
import { FocusModeWebNotificationEffects } from './focus-mode-web-notification.effects';
import * as selectors from './focus-mode.selectors';
import { FocusModeMode, TimerState } from '../focus-mode.model';
import { NotifyService } from '../../../core/notify/notify.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { FocusModeLocalSettingsService } from '../../config/focus-mode-local-settings.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { T } from '../../../t.const';

const timer = (partial: Partial<TimerState>): TimerState => ({
  isRunning: true,
  startedAt: 1000,
  elapsed: 0,
  duration: 25 * 60 * 1000,
  purpose: 'work',
  ...partial,
});

describe('FocusModeWebNotificationEffects', () => {
  let store: MockStore;
  let notifyService: jasmine.SpyObj<NotifyService>;
  let timerSelector: MemoizedSelector<object, TimerState>;
  let modeSelector: MemoizedSelector<object, FocusModeMode>;
  let isWeb: boolean;
  let isSettingOn: boolean;
  let hasFocus: boolean;
  let permission: NotificationPermission;
  let isInSyncWindow: ReturnType<typeof signal<boolean>>;
  let isInSyncWindow$: BehaviorSubject<boolean>;
  let sub: Subscription;

  const setTimer = (t: TimerState): void => {
    timerSelector.setResult(t);
    store.refreshState();
  };

  const runToBreakEnd = (): void => {
    setTimer(timer({ purpose: 'break', duration: 5000, elapsed: 0 }));
    setTimer(
      timer({ purpose: 'break', duration: 5000, elapsed: 5000, isRunning: false }),
    );
  };

  beforeEach(() => {
    isWeb = true;
    isSettingOn = true;
    hasFocus = false;
    permission = 'granted';
    isInSyncWindow = signal(false);
    isInSyncWindow$ = new BehaviorSubject(false);
    notifyService = jasmine.createSpyObj('NotifyService', ['notify']);
    notifyService.notify.and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        FocusModeWebNotificationEffects,
        provideMockStore(),
        { provide: NotifyService, useValue: notifyService },
        { provide: CapacitorPlatformService, useValue: { isWeb: () => isWeb } },
        {
          provide: FocusModeLocalSettingsService,
          useValue: {
            settings: () => ({
              isLoopBreakEndAlarm: false,
              isNotifyOnSessionEnd: isSettingOn,
            }),
          },
        },
        { provide: DOCUMENT, useValue: { hasFocus: () => hasFocus } },
        {
          provide: HydrationStateService,
          useValue: { isInSyncWindow, isInSyncWindow$ },
        },
      ],
    });

    spyOnProperty(Notification, 'permission', 'get').and.callFake(() => permission);
    store = TestBed.inject(MockStore);
    timerSelector = store.overrideSelector(selectors.selectTimer, timer({ elapsed: 0 }));
    modeSelector = store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
    sub = TestBed.inject(FocusModeWebNotificationEffects).notifyOnTimeUp$.subscribe();
  });

  afterEach(() => {
    sub.unsubscribe();
    store.resetSelectors();
  });

  it('notifies once when a Pomodoro session reaches its duration', () => {
    setTimer(timer({ elapsed: 25 * 60 * 1000 }));
    // later ticks and pause/resume in overtime (new startedAt) must not re-notify
    setTimer(timer({ elapsed: 26 * 60 * 1000 }));
    setTimer(timer({ elapsed: 26 * 60 * 1000, startedAt: 5000, isRunning: false }));

    expect(notifyService.notify).toHaveBeenCalledOnceWith({
      title: T.F.FOCUS_MODE.POMODORO_SESSION_COMPLETED,
    });
  });

  it('notifies when a break ends', () => {
    runToBreakEnd();

    expect(notifyService.notify).toHaveBeenCalledOnceWith({
      title: T.F.POMODORO.BREAK_IS_DONE,
    });
  });

  it('notifies again for the next session after a break', () => {
    setTimer(timer({ elapsed: 25 * 60 * 1000 }));
    runToBreakEnd();
    setTimer(timer({ elapsed: 0, startedAt: 9000 }));
    setTimer(timer({ elapsed: 25 * 60 * 1000, startedAt: 9000 }));

    expect(notifyService.notify).toHaveBeenCalledTimes(3);
  });

  it('notifies again when an overtime session is extended and reaches the new end', () => {
    setTimer(timer({ elapsed: 25 * 60 * 1000 }));
    // extending pushes the end past elapsed, so the session is no longer time-up
    setTimer(timer({ elapsed: 25 * 60 * 1000, duration: 30 * 60 * 1000 }));
    setTimer(timer({ elapsed: 30 * 60 * 1000, duration: 30 * 60 * 1000 }));

    expect(notifyService.notify).toHaveBeenCalledTimes(2);
  });

  it('skips Countdown session ends, which FocusModeEffects already notifies', () => {
    modeSelector.setResult(FocusModeMode.Countdown);
    setTimer(timer({ elapsed: 25 * 60 * 1000 }));

    expect(notifyService.notify).not.toHaveBeenCalled();
  });

  it('skips Flowtime sessions, which have no duration', () => {
    modeSelector.setResult(FocusModeMode.Flowtime);
    setTimer(timer({ duration: 0, elapsed: 60 * 60 * 1000 }));

    expect(notifyService.notify).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off', () => {
    isSettingOn = false;
    runToBreakEnd();

    expect(notifyService.notify).not.toHaveBeenCalled();
  });

  it('does nothing outside the web app', () => {
    isWeb = false;
    runToBreakEnd();

    expect(notifyService.notify).not.toHaveBeenCalled();
  });

  it('does nothing while the app has focus', () => {
    hasFocus = true;
    runToBreakEnd();

    expect(notifyService.notify).not.toHaveBeenCalled();
  });

  it('does nothing and never prompts when permission is not granted', () => {
    permission = 'denied';
    const requestSpy = spyOn(Notification, 'requestPermission');
    runToBreakEnd();

    expect(notifyService.notify).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('defers a time-up during a sync window instead of dropping it', () => {
    isInSyncWindow.set(true);
    isInSyncWindow$.next(true);
    runToBreakEnd();
    expect(notifyService.notify).not.toHaveBeenCalled();

    isInSyncWindow.set(false);
    isInSyncWindow$.next(false);
    expect(notifyService.notify).toHaveBeenCalledTimes(1);
  });
});
