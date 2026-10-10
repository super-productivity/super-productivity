import { BehaviorSubject, Subscription } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  AndroidFocusModeEffects,
  FOCUS_ANDROID_INTERFACE,
  hasFocusNotificationStateChanged,
  parseNativeFocusModeData,
  shouldHandleNativeTimerComplete,
  getFocusServiceCall,
} from './android-focus-mode.effects';
import { TimerState, FocusModeMode } from '../../focus-mode/focus-mode.model';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../../util/is-android-web-view';
import { AndroidInterface } from '../android-interface';
import {
  selectTimer,
  selectMode,
  selectPausedTaskId,
} from '../../focus-mode/store/focus-mode.selectors';
import { selectCurrentTask, selectTaskEntities } from '../../tasks/store/task.selectors';
import { createTask } from '../../tasks/task.test-helper';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskService } from '../../tasks/task.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { AndroidNotificationActionService } from '../android-notification-action.service';

const MIN = 60_000;
const workTimer = (elapsed: number, over: Partial<TimerState> = {}): TimerState => ({
  isRunning: true,
  startedAt: 0,
  elapsed,
  duration: 25 * MIN,
  purpose: 'work',
  ...over,
});

// The notification reconciles with the in-app countdown only when
// syncFocusModeToNotification$ decides state changed. Elapsed-only updates are
// throttled to 5s, but the large elapsed jump produced by a resume tick (#7856)
// must cross that threshold so the corrected value is pushed to native — closing
// the loop so BOTH the app and the notification end up correct.
describe('hasFocusNotificationStateChanged (notification reconciliation, #7856)', () => {
  it('pushes a native update after a resume tick (elapsed jumps well past 5s)', () => {
    // Backgrounded at 5 min elapsed; resume tick recomputes elapsed to 15 min.
    const beforeResume = workTimer(5 * MIN);
    const afterResume = workTimer(15 * MIN);

    expect(hasFocusNotificationStateChanged(beforeResume, afterResume)).toBe(true);
  });

  it('throttles a normal 1-second tick (elapsed diff < 5s)', () => {
    expect(hasFocusNotificationStateChanged(workTimer(60_000), workTimer(61_000))).toBe(
      false,
    );
  });

  it('pushes immediately when the timer is paused/resumed (isRunning flips)', () => {
    const running = workTimer(5 * MIN);
    const paused = workTimer(5 * MIN, { isRunning: false });

    expect(hasFocusNotificationStateChanged(running, paused)).toBe(true);
  });

  it('pushes immediately when purpose changes (work -> break)', () => {
    const work = workTimer(5 * MIN);
    const brk = workTimer(5 * MIN, { purpose: 'break' });

    expect(hasFocusNotificationStateChanged(work, brk)).toBe(true);
  });

  it('always pushes the first emission (no previous state)', () => {
    expect(hasFocusNotificationStateChanged(undefined, workTimer(0))).toBe(true);
  });
});

describe('hasFocusNotificationStateChanged (task reconciliation, #9399)', () => {
  it('pushes immediately when the current task changes without a timer change', () => {
    const timer = workTimer(0);

    expect(
      hasFocusNotificationStateChanged(
        timer,
        timer,
        { id: 'task-a', title: 'Task A' },
        { id: 'task-b', title: 'Task B' },
      ),
    ).toBe(true);
  });

  it('pushes immediately when the current task title changes', () => {
    const timer = workTimer(0);

    expect(
      hasFocusNotificationStateChanged(
        timer,
        timer,
        { id: 'task-a', title: 'Old title' },
        { id: 'task-a', title: 'New title' },
      ),
    ).toBe(true);
  });

  it('still throttles a normal tick when the current task is unchanged', () => {
    const task = { id: 'task-a', title: 'Task A' };

    expect(
      hasFocusNotificationStateChanged(workTimer(60_000), workTimer(61_000), task, task),
    ).toBe(false);
  });
});

// handleNativeTimerComplete$ acts on a native completion only while the matching
// session is still active. The work-session guard is what prevents a double
// completion when a resume tick (#7856) already finished the session before the
// buffered native event is delivered.
describe('shouldHandleNativeTimerComplete (native completion guard, #7856)', () => {
  it('handles a work completion while the work timer is still running', () => {
    expect(shouldHandleNativeTimerComplete(false, workTimer(25 * MIN))).toBe(true);
  });

  it('ignores a work completion once the timer has stopped (resume tick already completed it)', () => {
    expect(
      shouldHandleNativeTimerComplete(false, workTimer(34 * MIN, { isRunning: false })),
    ).toBe(false);
  });

  it('ignores a work completion when the session is already idle (purpose null)', () => {
    expect(
      shouldHandleNativeTimerComplete(
        false,
        workTimer(0, { isRunning: false, purpose: null }),
      ),
    ).toBe(false);
  });

  it('handles a break completion while a break is active', () => {
    expect(
      shouldHandleNativeTimerComplete(true, workTimer(5 * MIN, { purpose: 'break' })),
    ).toBe(true);
  });

  it('ignores a break completion when the active session is work, not break', () => {
    expect(shouldHandleNativeTimerComplete(true, workTimer(5 * MIN))).toBe(false);
  });
});

// A stale/duplicate native completion must not complete a *different* session
// than the one it was fired for. Landing on the fresh work session the user just
// advanced into (break -> "next session" arrow) would, in Pomodoro, immediately
// auto-spawn a break — the reported #8805 symptom.
describe('shouldHandleNativeTimerComplete (stale/duplicate completion guard, #8805)', () => {
  const START = 1_000_000;
  const WORK_DURATION = 25 * MIN;
  const BREAK_DURATION = 5 * MIN;

  it('ignores a work completion on a work session that only just started (wall clock < duration)', () => {
    const freshWork = workTimer(0, { startedAt: START });
    expect(shouldHandleNativeTimerComplete(false, freshWork, START + 500)).toBe(false);
  });

  it('handles a work completion once the session has reached its duration by wall clock, even with a frozen/stale elapsed (#7856 over-run)', () => {
    // Backgrounded: stored elapsed frozen at 10 min, but 25 min of real time has
    // passed since startedAt — the completion is genuine and must be handled.
    const overrun = workTimer(10 * MIN, { startedAt: START });
    expect(shouldHandleNativeTimerComplete(false, overrun, START + WORK_DURATION)).toBe(
      true,
    );
  });

  it('handles a work completion delivered slightly early (within tolerance)', () => {
    const nearlyDone = workTimer(0, { startedAt: START });
    expect(
      shouldHandleNativeTimerComplete(false, nearlyDone, START + WORK_DURATION - 500),
    ).toBe(true);
  });

  it('ignores a break completion on a break that only just started', () => {
    const freshBreak = workTimer(0, {
      startedAt: START,
      purpose: 'break',
      duration: BREAK_DURATION,
    });
    expect(shouldHandleNativeTimerComplete(true, freshBreak, START + 500)).toBe(false);
  });

  it('handles a break completion once the break has run its scheduled length', () => {
    // Break stopped in-app (isRunning false) with the arrow showing; the native
    // completion still auto-advances because the break reached its duration.
    const doneBreak = workTimer(0, {
      startedAt: START,
      isRunning: false,
      purpose: 'break',
      duration: BREAK_DURATION,
    });
    expect(shouldHandleNativeTimerComplete(true, doneBreak, START + BREAK_DURATION)).toBe(
      true,
    );
  });

  it('ignores a completion when the timer has no startedAt (defensive)', () => {
    // A running timer always has a startedAt in practice; guard defensively so a
    // null can never pass the wall-clock check via `null` arithmetic.
    const noStart = workTimer(0, { startedAt: null });
    expect(shouldHandleNativeTimerComplete(false, noStart, START + WORK_DURATION)).toBe(
      false,
    );
  });

  it('ignores a work completion for a Flowtime session (duration 0 never schedules a native completion)', () => {
    const flowtime = workTimer(0, { startedAt: START, duration: 0 });
    expect(shouldHandleNativeTimerComplete(false, flowtime, START + WORK_DURATION)).toBe(
      false,
    );
  });
});

describe('getFocusServiceCall (native service lost, #9531)', () => {
  const breakTimer = (over: Partial<TimerState> = {}): TimerState =>
    workTimer(0, { purpose: 'break', duration: 5 * MIN, ...over });
  const call = (
    over: Partial<Parameters<typeof getFocusServiceCall>[0]> = {},
  ): ReturnType<typeof getFocusServiceCall> =>
    getFocusServiceCall({
      wasFocusModeActive: true,
      isStateChanged: true,
      isResumed: false,
      isInBackground: false,
      timer: workTimer(10 * MIN),
      isNativeServiceRunning: () => true,
      ...over,
    });

  it('starts the service when a session begins', () => {
    expect(call({ wasFocusModeActive: false, isNativeServiceRunning: () => false })).toBe(
      'start',
    );
  });

  it('updates the service while it is still running', () => {
    expect(call()).toBe('update');
  });

  it('does nothing without a notification-relevant change', () => {
    expect(call({ isStateChanged: false })).toBeNull();
  });

  it('restarts the next Pomodoro after the background start was refused', () => {
    // Work -> break -> work runs while the app is in the background: the native
    // service stops itself at each completion and Android 12+ refuses the new
    // foreground-service start, so app state stays active with no service.
    const nativeRunning = { value: true };
    const isNativeServiceRunning = (): boolean => nativeRunning.value;
    expect(call({ timer: workTimer(20 * MIN), isNativeServiceRunning })).toBe('update');
    nativeRunning.value = false; // completed natively, break start refused
    expect(
      call({ wasFocusModeActive: false, timer: breakTimer(), isNativeServiceRunning }),
    ).toBe('start');
    // Break completed natively; skipBreak auto-starts work, start refused again.
    expect(
      call({ wasFocusModeActive: false, timer: workTimer(0), isNativeServiceRunning }),
    ).toBe('start');

    // The resume tick on return must start, not update, the dead service.
    expect(call({ timer: workTimer(3 * MIN), isNativeServiceRunning })).toBe('start');
  });

  it('restarts on the first tick after a quick return, below the 5s update gate', () => {
    // Tapping the completion notification right after the background auto-start
    // returns within 5s, so no tick passes hasFocusNotificationStateChanged.
    expect(
      call({
        isStateChanged: false,
        isResumed: true,
        timer: workTimer(2_000),
        isNativeServiceRunning: () => false,
      }),
    ).toBe('start');
  });

  it('sends nothing after a resume while the service is still running', () => {
    expect(call({ isStateChanged: false, isResumed: true })).toBeNull();
  });

  it('leaves a stopped session to the completion path instead of restarting', () => {
    // A resume tick that ends a session natively completed while away stops the
    // timer; restarting would only replace the completion notification.
    expect(
      call({
        isResumed: true,
        timer: workTimer(25 * MIN, { isRunning: false }),
        isNativeServiceRunning: () => false,
      }),
    ).toBe('update');
  });

  it('does not restart a lost service while the app is in the background', () => {
    // Android 12+ refuses the start there, and the failure shows a misleading
    // "open notification settings" warning; the old update path failed silently.
    expect(call({ isInBackground: true, isNativeServiceRunning: () => false })).toBe(
      'update',
    );
  });

  it('restarts a lost service on resume even before the background flag clears', () => {
    expect(
      call({
        isStateChanged: false,
        isResumed: true,
        isInBackground: true,
        isNativeServiceRunning: () => false,
      }),
    ).toBe('start');
  });

  it('restarts a lost service while the app is in the foreground', () => {
    expect(call({ isInBackground: false, isNativeServiceRunning: () => false })).toBe(
      'start',
    );
  });

  it('still starts a new session while the app is in the background', () => {
    expect(
      call({
        wasFocusModeActive: false,
        isInBackground: true,
        isNativeServiceRunning: () => false,
      }),
    ).toBe('start');
  });
});

describe('AndroidFocusModeEffects: native break restart recovery', () => {
  const task = createTask({ id: 'paused-task', timeSpent: 900_000 });
  const timer = workTimer(0, { purpose: 'break', duration: 5 * MIN });
  let store: MockStore;
  let subscriptions: Subscription;
  let background$: BehaviorSubject<boolean>;
  let native: jasmine.SpyObj<Required<AndroidInterface>>;

  beforeEach(() => {
    background$ = new BehaviorSubject(true);
    native = jasmine.createSpyObj<Required<AndroidInterface>>(
      'androidInterface',
      ['getFocusModeElapsed', 'updateFocusTask', 'startFocusModeService'],
      { isInBackground$: background$ },
    );
    native.getFocusModeElapsed.and.returnValue('null');
    TestBed.configureTestingModule({
      providers: [
        AndroidFocusModeEffects,
        provideMockStore({
          selectors: [
            { selector: selectTimer, value: timer },
            { selector: selectMode, value: FocusModeMode.Pomodoro },
            { selector: selectCurrentTask, value: null },
            { selector: selectPausedTaskId, value: task.id },
            { selector: selectTaskEntities, value: { [task.id]: task } },
          ],
        }),
        { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: true },
        { provide: FOCUS_ANDROID_INTERFACE, useValue: native },
        {
          provide: HydrationStateService,
          useValue: { isApplyingRemoteOps: () => false },
        },
        ...[
          SnackService,
          GlobalTrackingIntervalService,
          CapacitorReminderService,
          LOCAL_ACTIONS,
          TaskService,
          SyncTriggerService,
          DataInitStateService,
          OperationWriteFlushService,
          AndroidNotificationActionService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    });
    store = TestBed.inject(MockStore);
    const effects = TestBed.inject(AndroidFocusModeEffects);
    subscriptions = new Subscription();
    if (!effects.trackAppBackgroundState$ || !effects.syncFocusModeToNotification$) {
      throw new Error('Android notification effects must be enabled');
    }
    subscriptions.add(effects.trackAppBackgroundState$.subscribe());
    subscriptions.add(effects.syncFocusModeToNotification$.subscribe());
    native.updateFocusTask.calls.reset();
    native.startFocusModeService.calls.reset();
  });

  afterEach(() => {
    subscriptions.unsubscribe();
    store.resetSelectors();
  });

  it('restages the unchanged paused task before restarting a lost break service on resume', () => {
    // The background start failed and consumed the pending native task data.
    // A quick return changes neither the paused task nor the notification state.
    background$.next(false);
    store.overrideSelector(selectTimer, { ...timer, elapsed: 1_000 });
    store.refreshState();

    expect(native.updateFocusTask).toHaveBeenCalledOnceWith(
      task.id,
      task.timeSpent,
      false,
    );
    expect(native.updateFocusTask).toHaveBeenCalledBefore(native.startFocusModeService);
    expect(native.startFocusModeService).toHaveBeenCalledOnceWith(
      'Break',
      5 * MIN,
      299_000,
      true,
      false,
      null,
    );
  });

  it('keeps the task clock untouched on a quick resume while the native service survives', () => {
    native.getFocusModeElapsed.and.returnValue('{}');
    background$.next(false);
    store.overrideSelector(selectTimer, { ...timer, elapsed: 1_000 });
    store.refreshState();

    expect(native.updateFocusTask).not.toHaveBeenCalled();
    expect(native.startFocusModeService).not.toHaveBeenCalled();
  });
});

// --- #7855: focus-session recovery helpers (see #7866) ---
describe('AndroidFocusModeEffects helpers (#7855)', () => {
  describe('parseNativeFocusModeData', () => {
    it('reads the task clock independently of the focus session duration', () => {
      const data = {
        durationMs: 0,
        remainingMs: 180_000,
        isBreak: false,
        isPaused: false,
        taskId: 'tracked-task',
        taskTimeSpentMs: 900_000,
        isTaskTracking: true,
      };
      expect(parseNativeFocusModeData(JSON.stringify(data))).toEqual(data);
    });

    it('retains the task association when its native clock is paused', () => {
      const data = {
        durationMs: 0,
        remainingMs: 180_000,
        isBreak: false,
        isPaused: true,
        taskId: 'paused-task',
        taskTimeSpentMs: 900_000,
        isTaskTracking: false,
      };
      expect(parseNativeFocusModeData(JSON.stringify(data))).toEqual(data);
    });
    it('returns null for falsy / "null" input', () => {
      expect(parseNativeFocusModeData(null)).toBeNull();
      expect(parseNativeFocusModeData(undefined)).toBeNull();
      expect(parseNativeFocusModeData('')).toBeNull();
      expect(parseNativeFocusModeData('null')).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parseNativeFocusModeData('{not json')).toBeNull();
    });

    it('returns null when fields are missing or wrong type', () => {
      expect(parseNativeFocusModeData('{"durationMs":1000}')).toBeNull();
      expect(
        parseNativeFocusModeData(
          '{"durationMs":"1000","remainingMs":500,"isBreak":false,"isPaused":false}',
        ),
      ).toBeNull();
      expect(
        parseNativeFocusModeData(
          '{"durationMs":1000,"remainingMs":500,"isBreak":"no","isPaused":false}',
        ),
      ).toBeNull();
    });

    it('parses a valid countdown payload', () => {
      expect(
        parseNativeFocusModeData(
          '{"durationMs":1500000,"remainingMs":600000,"isBreak":false,"isPaused":false}',
        ),
      ).toEqual({
        durationMs: 1500000,
        remainingMs: 600000,
        isBreak: false,
        isPaused: false,
      });
    });

    it('parses a paused break payload', () => {
      expect(
        parseNativeFocusModeData(
          '{"durationMs":300000,"remainingMs":120000,"isBreak":true,"isPaused":true}',
        ),
      ).toEqual({
        durationMs: 300000,
        remainingMs: 120000,
        isBreak: true,
        isPaused: true,
      });
    });

    it('parses a Flowtime payload (durationMs 0)', () => {
      const parsed = parseNativeFocusModeData(
        '{"durationMs":0,"remainingMs":720000,"isBreak":false,"isPaused":false}',
      );
      expect(parsed?.durationMs).toBe(0);
      expect(parsed?.remainingMs).toBe(720000);
    });
  });

  // Regression for the destructive cold-start stop: on the `startWith(null)`
  // seed, `prev` is null and the OLD code computed
  // `wasFocusModeActive = prev?.timer?.purpose !== null` === true, which fired
  // stopFocusModeService() and tore down a surviving native notification.
  describe('cold-start "was active" decision', () => {
    const wasFocusModeActive = (
      prev: { timer: { purpose: string | null } } | null,
    ): boolean => !!prev && prev.timer.purpose !== null;

    it('treats the null seed (cold start) as NOT active → no stop', () => {
      expect(wasFocusModeActive(null)).toBe(false);
    });

    it('treats a previously idle store as NOT active', () => {
      expect(wasFocusModeActive({ timer: { purpose: null } })).toBe(false);
    });

    it('treats a previously running session as active', () => {
      expect(wasFocusModeActive({ timer: { purpose: 'work' } })).toBe(true);
    });
  });
});
