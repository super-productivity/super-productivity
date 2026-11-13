import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MemoizedSelector } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Observable, of, Subject, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  FOCUS_SESSION_END_NOTIFICATION_ID,
  FocusModeIosNotificationEffects,
} from './focus-mode-ios-notification.effects';
import * as selectors from './focus-mode.selectors';
import { FocusModeMode, TimerState } from '../focus-mode.model';
import { selectSoundConfig } from '../../config/store/global-config.reducer';
import { SoundConfig } from '../../config/global-config.model';
import { CapacitorNotificationService } from '../../../core/platform/capacitor-notification.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { T } from '../../../t.const';

// 2026-01-01T10:00:00.000Z
const NOW = 1767261600000;
const IDLE: TimerState = {
  isRunning: false,
  startedAt: null,
  elapsed: 0,
  duration: 0,
  purpose: null,
};

// A 25 min work session started at NOW
const timer = (partial: Partial<TimerState> = {}): TimerState => ({
  isRunning: true,
  startedAt: NOW,
  elapsed: 0,
  duration: 1500000,
  purpose: 'work',
  ...partial,
});

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('FocusModeIosNotificationEffects', () => {
  let store: MockStore;
  let notificationService: jasmine.SpyObj<CapacitorNotificationService>;
  let timerSelector: MemoizedSelector<object, TimerState>;
  let modeSelector: MemoizedSelector<object, FocusModeMode>;
  let soundSelector: MemoizedSelector<object, SoundConfig>;
  let languageLoaded$: Observable<unknown>;
  let isInSyncWindow: ReturnType<typeof signal<boolean>>;
  let isInSyncWindow$: BehaviorSubject<boolean>;
  let sub: Subscription;

  const setTimer = async (t: TimerState): Promise<void> => {
    timerSelector.setResult(t);
    store.refreshState();
    await flushPromises();
  };

  const setMode = async (mode: FocusModeMode): Promise<void> => {
    modeSelector.setResult(mode);
    store.refreshState();
    await flushPromises();
  };

  const init = async (): Promise<void> => {
    sub = TestBed.inject(
      FocusModeIosNotificationEffects,
    ).syncSessionEndNotification$.subscribe();
    await flushPromises();
  };

  const setNow = (now: number): void => {
    (Date.now as jasmine.Spy).and.returnValue(now);
  };

  beforeEach(() => {
    languageLoaded$ = of(null);
    isInSyncWindow = signal(false);
    isInSyncWindow$ = new BehaviorSubject(false);
    notificationService = jasmine.createSpyObj('CapacitorNotificationService', [
      'schedule',
      'cancel',
    ]);
    notificationService.schedule.and.resolveTo(true);
    notificationService.cancel.and.resolveTo(true);
    spyOn(Date, 'now').and.returnValue(NOW);

    TestBed.configureTestingModule({
      providers: [
        FocusModeIosNotificationEffects,
        provideMockStore(),
        { provide: CapacitorNotificationService, useValue: notificationService },
        {
          provide: TranslateService,
          useValue: {
            get: (key: string, params?: { duration: string }) =>
              languageLoaded$.pipe(
                map(() => (params ? `${key}|${params.duration}` : key)),
              ),
          },
        },
        {
          provide: HydrationStateService,
          useValue: { isInSyncWindow, isInSyncWindow$ },
        },
      ],
    });

    store = TestBed.inject(MockStore);
    timerSelector = store.overrideSelector(selectors.selectTimer, IDLE);
    modeSelector = store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
    soundSelector = store.overrideSelector(selectSoundConfig, {
      volume: 75,
    } as SoundConfig);
  });

  afterEach(() => {
    sub?.unsubscribe();
    store.resetSelectors();
  });

  it('schedules one notification for the session end when a Pomodoro session starts', async () => {
    await init();
    await setTimer(timer());

    expect(notificationService.schedule).toHaveBeenCalledOnceWith({
      id: 2147483647,
      title: T.F.FOCUS_MODE.POMODORO_SESSION_COMPLETED,
      body: '',
      // NOW + 25 min
      scheduleAt: new Date('2026-01-01T10:25:00.000Z'),
      sound: 'default',
      isShownInForeground: false,
    });
    expect(notificationService.cancel).not.toHaveBeenCalled();
    expect(FOCUS_SESSION_END_NOTIFICATION_ID).toBe(2147483647);
  });

  it('reports the session length for a Countdown session', async () => {
    await init();
    await setMode(FocusModeMode.Countdown);
    await setTimer(timer());

    expect(notificationService.schedule).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        id: 2147483647,
        title: T.F.FOCUS_MODE.SESSION_COMPLETED,
        body: `${T.F.FOCUS_MODE.SESSION_COMPLETED_NOTIFICATION_BODY}|25m`,
        scheduleAt: new Date('2026-01-01T10:25:00.000Z'),
      }),
    );
  });

  it('schedules the end of a break', async () => {
    await init();
    await setTimer(timer({ purpose: 'break', duration: 300000 }));

    expect(notificationService.schedule).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        id: 2147483647,
        title: T.F.POMODORO.BREAK_IS_DONE,
        body: '',
        // NOW + 5 min
        scheduleAt: new Date('2026-01-01T10:05:00.000Z'),
      }),
    );
  });

  it('schedules the end of a Flowtime break', async () => {
    await init();
    await setMode(FocusModeMode.Flowtime);
    await setTimer(timer({ purpose: 'break', duration: 300000 }));

    expect(notificationService.schedule).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        title: T.F.POMODORO.BREAK_IS_DONE,
        scheduleAt: new Date('2026-01-01T10:05:00.000Z'),
      }),
    );
  });

  it('does not reschedule on ticks', async () => {
    await init();
    await setTimer(timer());
    await setTimer(timer({ elapsed: 1000 }));
    await setTimer(timer({ elapsed: 2000 }));

    expect(notificationService.schedule).toHaveBeenCalledTimes(1);
    expect(notificationService.cancel).not.toHaveBeenCalled();
  });

  it('cancels on pause and reschedules for the new end on resume', async () => {
    await init();
    await setTimer(timer());
    // paused after 10 min
    await setTimer(timer({ elapsed: 600000, isRunning: false }));

    expect(notificationService.cancel).toHaveBeenCalledOnceWith(2147483647);
    expect(notificationService.schedule).toHaveBeenCalledTimes(1);

    // resumed 5 min later: the reducer moves startedAt to (resume time - elapsed)
    await setTimer(timer({ elapsed: 600000, startedAt: NOW + 300000 }));

    expect(notificationService.schedule).toHaveBeenCalledTimes(2);
    expect(notificationService.schedule.calls.mostRecent().args[0].scheduleAt).toEqual(
      new Date('2026-01-01T10:30:00.000Z'),
    );
  });

  it('cancels when the session is stopped, skipped or completed', async () => {
    await init();
    await setTimer(timer());
    await setTimer(IDLE);

    expect(notificationService.cancel).toHaveBeenCalledOnceWith(2147483647);
    expect(notificationService.schedule).toHaveBeenCalledTimes(1);
  });

  // The last tick before iOS suspends JS must not remove a notification that is due
  it('leaves the notification alone when the timer reaches its end', async () => {
    await init();
    await setTimer(timer({ purpose: 'break', duration: 300000 }));
    setNow(NOW + 300000);
    // what the tick reducer leaves behind when a break reaches its duration
    await setTimer(
      timer({ purpose: 'break', duration: 300000, elapsed: 300000, isRunning: false }),
    );
    await setTimer(IDLE);

    expect(notificationService.cancel).not.toHaveBeenCalled();
    expect(notificationService.schedule).toHaveBeenCalledTimes(1);
  });

  it('reschedules when the duration changes', async () => {
    await init();
    await setTimer(timer());
    // +5 min
    await setTimer(timer({ duration: 1800000 }));

    expect(notificationService.schedule).toHaveBeenCalledTimes(2);
    expect(notificationService.schedule.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        id: 2147483647,
        scheduleAt: new Date('2026-01-01T10:30:00.000Z'),
      }),
    );
    // the fixed id replaces the pending request; no cancel is needed
    expect(notificationService.cancel).not.toHaveBeenCalled();
  });

  it('moves the notification from the session end to the break end', async () => {
    await init();
    await setTimer(timer());
    // break started when the session ended at 10:25
    await setTimer(
      timer({ purpose: 'break', duration: 300000, startedAt: NOW + 1500000 }),
    );

    expect(notificationService.schedule.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        id: 2147483647,
        title: T.F.POMODORO.BREAK_IS_DONE,
        scheduleAt: new Date('2026-01-01T10:30:00.000Z'),
      }),
    );
  });

  it('reschedules when an overtime session is extended past its duration', async () => {
    await init();
    await setTimer(timer());
    setNow(NOW + 1500000);
    await setTimer(timer({ elapsed: 1500000 }));

    // pause/resume in overtime rewrites startedAt; the end stays in the past
    setNow(NOW + 1620000);
    await setTimer(timer({ elapsed: 1560000, startedAt: NOW + 60000 }));
    expect(notificationService.schedule).toHaveBeenCalledTimes(1);
    expect(notificationService.cancel).not.toHaveBeenCalled();

    // extended by 10 min: ends 35 min after the shifted start (10:01)
    await setTimer(
      timer({ elapsed: 1560000, startedAt: NOW + 60000, duration: 2100000 }),
    );
    expect(notificationService.schedule.calls.mostRecent().args[0].scheduleAt).toEqual(
      new Date('2026-01-01T10:36:00.000Z'),
    );
  });

  it('never schedules for a Flowtime session, which has no end', async () => {
    await init();
    await setMode(FocusModeMode.Flowtime);
    await setTimer(timer({ duration: 0 }));
    await setTimer(timer({ duration: 0, elapsed: 3600000 }));

    expect(notificationService.schedule).not.toHaveBeenCalled();
  });

  // iOS would deliver a notification dated in the past immediately
  it('does not schedule when the end has already passed', async () => {
    await init();
    // restored after the WebView was killed: the session ended 1 min ago
    setNow(NOW + 1560000);
    await setTimer(timer());

    expect(notificationService.schedule).not.toHaveBeenCalled();
    expect(notificationService.cancel).not.toHaveBeenCalled();
  });

  it('cancels when the duration is cut to before now', async () => {
    await init();
    await setTimer(timer());
    setNow(NOW + 600000);
    // cut to 10 min at 10:10; the last tick left elapsed just short of it
    await setTimer(timer({ elapsed: 599500, duration: 600000 }));

    expect(notificationService.cancel).toHaveBeenCalledOnceWith(2147483647);
    expect(notificationService.schedule).toHaveBeenCalledTimes(1);
  });

  it('schedules a silent notification while the sound volume is 0', async () => {
    soundSelector.setResult({ volume: 0 } as SoundConfig);
    await init();
    await setTimer(timer());

    expect(notificationService.schedule).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ id: 2147483647, sound: null }),
    );
  });

  it('keeps a notification left by a killed WebView on startup and re-arms it on restore', async () => {
    await init();

    expect(notificationService.cancel).not.toHaveBeenCalled();
    expect(notificationService.schedule).not.toHaveBeenCalled();

    // session restore re-adopts the session 10 min in
    setNow(NOW + 600000);
    await setTimer(timer({ elapsed: 600000 }));

    expect(notificationService.schedule).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        id: 2147483647,
        scheduleAt: new Date('2026-01-01T10:25:00.000Z'),
      }),
    );
  });

  it('waits for a pending schedule before cancelling', async () => {
    await init();
    let resolveSchedule: (v: boolean) => void = () => undefined;
    notificationService.schedule.and.returnValue(
      new Promise<boolean>((resolve) => (resolveSchedule = resolve)),
    );

    await setTimer(timer());
    await setTimer(IDLE);
    expect(notificationService.cancel).not.toHaveBeenCalled();

    resolveSchedule(true);
    await flushPromises();
    expect(notificationService.cancel).toHaveBeenCalledOnceWith(2147483647);
  });

  it('waits for a pending cancel before scheduling', async () => {
    await init();
    await setTimer(timer());
    let resolveCancel: (v: boolean) => void = () => undefined;
    notificationService.cancel.and.returnValue(
      new Promise<boolean>((resolve) => (resolveCancel = resolve)),
    );

    await setTimer(timer({ elapsed: 600000, isRunning: false }));
    await setTimer(timer({ elapsed: 600000, startedAt: NOW + 300000 }));
    expect(notificationService.schedule).toHaveBeenCalledTimes(1);

    resolveCancel(true);
    await flushPromises();
    expect(notificationService.schedule).toHaveBeenCalledTimes(2);
  });

  it('defers a start during a sync window instead of dropping it', async () => {
    await init();
    isInSyncWindow.set(true);
    isInSyncWindow$.next(true);
    await setTimer(timer());
    expect(notificationService.schedule).not.toHaveBeenCalled();

    isInSyncWindow.set(false);
    isInSyncWindow$.next(false);
    await flushPromises();
    expect(notificationService.schedule).toHaveBeenCalledTimes(1);
  });

  // A session restored on a cold start can be scheduled before the language file is in
  it('waits for the language file before scheduling', async () => {
    const loaded$ = new Subject<void>();
    languageLoaded$ = loaded$;
    await init();
    await setTimer(timer());
    expect(notificationService.schedule).not.toHaveBeenCalled();

    loaded$.next();
    await flushPromises();
    expect(notificationService.schedule).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ title: T.F.FOCUS_MODE.POMODORO_SESSION_COMPLETED }),
    );
  });
});
