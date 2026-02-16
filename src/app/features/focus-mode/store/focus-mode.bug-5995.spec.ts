/**
 * Integration tests for GitHub issue #5995
 * https://github.com/super-productivity/super-productivity/issues/5995
 *
 * Bug #3: Resuming a paused break from banner starts next Pomodoro session
 *
 * When you:
 * 1. Pause a Pomodoro break from the banner
 * 2. Click Resume in the banner
 *
 * Expected: Break should continue from where it was paused
 * Bug: Break is skipped and next work session starts
 *
 * Fix:
 * Use store-based _isResumingBreak flag set by unPauseFocusSession reducer.
 * When tracking starts during a break, check if it was caused by resuming (don't skip)
 * vs user manually starting tracking (skip the break - preserves bug #5875 fix).
 */

import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, ReplaySubject } from 'rxjs';
import { FocusModeEffects } from './focus-mode.effects';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { BannerService } from '../../../core/banner/banner.service';
import { MetricService } from '../../metric/metric.service';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { TakeABreakService } from '../../take-a-break/take-a-break.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import * as actions from './focus-mode.actions';
import * as selectors from './focus-mode.selectors';
import { FocusModeMode, FocusScreen, TimerState } from '../focus-mode.model';
import { setCurrentTask } from '../../tasks/store/task.actions';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
} from '../../config/store/global-config.reducer';
import { Action } from '@ngrx/store';

describe('FocusMode Bug #5995: Resume paused break', () => {
  let actions$: ReplaySubject<Action>;
  let effects: FocusModeEffects;
  let store: MockStore;
  let strategyFactoryMock: any;
  let taskServiceMock: any;
  let globalConfigServiceMock: any;
  let metricServiceMock: any;
  let currentTaskId$: BehaviorSubject<string | null>;

  const createMockTimer = (overrides: Partial<TimerState> = {}): TimerState => ({
    isRunning: false,
    startedAt: null,
    elapsed: 0,
    duration: 0,
    purpose: null,
    ...overrides,
  });

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    currentTaskId$ = new BehaviorSubject<string | null>(null);

    strategyFactoryMock = {
      getStrategy: jasmine.createSpy('getStrategy').and.returnValue({
        initialSessionDuration: 25 * 60 * 1000,
        shouldStartBreakAfterSession: true,
        shouldAutoStartNextSession: true,
        getBreakDuration: jasmine
          .createSpy('getBreakDuration')
          .and.returnValue({ duration: 5 * 60 * 1000, isLong: false }),
      }),
    };

    taskServiceMock = {
      currentTaskId$: currentTaskId$.asObservable(),
      currentTaskId: jasmine.createSpy('currentTaskId').and.returnValue(null),
    };

    globalConfigServiceMock = {
      sound: jasmine.createSpy('sound').and.returnValue({ volume: 75 }),
    };

    metricServiceMock = {
      logFocusSession: jasmine.createSpy('logFocusSession'),
    };

    const takeABreakServiceMock = {
      otherNoBreakTIme$: new BehaviorSubject<number>(0),
    };

    TestBed.configureTestingModule({
      providers: [
        FocusModeEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            focusMode: {
              timer: createMockTimer(),
              mode: FocusModeMode.Pomodoro,
              currentCycle: 1,
              currentScreen: FocusScreen.Main,
              mainState: 'preparation',
              pausedTaskId: 'test-task-id',
              lastCompletedDuration: null,
              isOverlayShown: false,
              _isResumingBreak: false,
            },
            tasks: {
              entities: {
                ['test-task-id']: {
                  id: 'test-task-id',
                  title: 'Test Task',
                  projectId: null,
                  subTaskIds: [],
                  timeSpentOnDay: {},
                  timeSpent: 0,
                  timeEstimate: 0,
                  isDone: false,
                  created: Date.now(),
                  reminderId: null,
                  plannedAt: null,
                  _showSubTasksMode: 0,
                  attachments: [],
                  tagIds: [],
                  issueId: null,
                  issueWasUpdated: false,
                  issueLastUpdated: null,
                  issuePoints: null,
                  issueType: null,
                  issueAttachmentNr: null,
                  parentId: null,
                  notes: '',
                  dueDay: null,
                  repeatCfgId: null,
                },
              },
              ids: ['test-task-id'],
              currentTaskId: null,
              lastCurrentTaskId: null,
              selectedTaskId: null,
              taskDetailPanelTargetPanel: null,
              stateBefore: null,
              isDataLoaded: true,
            },
          },
        }),
        { provide: FocusModeStrategyFactory, useValue: strategyFactoryMock },
        { provide: TaskService, useValue: taskServiceMock },
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        { provide: BannerService, useValue: {} },
        { provide: MetricService, useValue: metricServiceMock },
        { provide: FocusModeStorageService, useValue: {} },
        { provide: TakeABreakService, useValue: takeABreakServiceMock },
        {
          provide: GlobalTrackingIntervalService,
          useValue: {
            todayStr$: new BehaviorSubject<string>('2024-01-19'),
          },
        },
      ],
    });

    effects = TestBed.inject(FocusModeEffects);
    store = TestBed.inject(MockStore);

    // Set up default selectors
    store.overrideSelector(selectFocusModeConfig, {
      isSkipPreparation: false,
      isSyncSessionWithTracking: true,
      isPauseTrackingDuringBreak: false,
    });
    store.overrideSelector(selectIsFocusModeEnabled, true);
  });

  afterEach(() => {
    actions$.complete();
  });

  describe('Bug #3: Resume paused break should continue break', () => {
    it('should NOT skip break when unPauseFocusSession is followed by tracking start', fakeAsync(() => {
      // Setup: Break is paused (not running, purpose = break)
      const pausedBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: false,
        elapsed: 2 * 60 * 1000, // 2 minutes elapsed
        duration: 5 * 60 * 1000, // 5 minute break
      });

      store.overrideSelector(selectors.selectTimer, pausedBreakTimer);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');
      store.overrideSelector(selectors.selectIsResumingBreak, false); // Initially false

      const dispatchedActions: Action[] = [];
      effects.syncTrackingStartToSession$.subscribe((action) => {
        dispatchedActions.push(action);
      });

      // Scenario: User clicks Resume in banner
      // 1. unPauseFocusSession is dispatched (reducer sets _isResumingBreak = true)
      actions$.next(actions.unPauseFocusSession());

      // Simulate reducer updating the flag
      store.overrideSelector(selectors.selectIsResumingBreak, true);
      store.refreshState();
      tick(10);

      // 2. syncSessionResumeToTracking$ resumes tracking
      currentTaskId$.next('test-task-id');
      tick(10);

      // Verify: clearResumingBreakFlag action is returned (break continues, no skip)
      expect(dispatchedActions.length).toBe(1);
      expect(dispatchedActions[0].type).toBe(actions.clearResumingBreakFlag.type);

      flush();
    }));

    it('should skip break when user manually starts tracking (preserves bug #5875 fix)', fakeAsync(() => {
      // Setup: Break is running
      const runningBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: true,
        elapsed: 2 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      store.overrideSelector(selectors.selectTimer, runningBreakTimer);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');
      store.overrideSelector(selectors.selectIsResumingBreak, false); // No break resume in progress

      const dispatchedActions: Action[] = [];
      effects.syncTrackingStartToSession$.subscribe((action) => {
        dispatchedActions.push(action);
      });

      // Scenario: User manually clicks play button on a task during break
      // (NOT after unPauseFocusSession)
      currentTaskId$.next('test-task-id');
      tick(10);

      // Verify: skipBreak was dispatched
      expect(dispatchedActions.length).toBe(1);
      expect(dispatchedActions[0].type).toBe(actions.skipBreak.type);
      expect((dispatchedActions[0] as any).pausedTaskId).toBe('test-task-id');

      flush();
    }));
  });

  describe('Bug #6534: Stale _isResumingBreak flag when isPauseTrackingDuringBreak is enabled', () => {
    it('should dispatch clearResumingBreakFlag when isPauseTrackingDuringBreak is enabled and break is resumed', fakeAsync(() => {
      // Setup: Break is paused, isPauseTrackingDuringBreak = true, tracking stopped
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isPauseTrackingDuringBreak: true,
      });

      const pausedBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: false,
        elapsed: 2 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      store.overrideSelector(selectors.selectTimer, pausedBreakTimer);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');
      currentTaskId$.next(null);

      const dispatchedActions: Action[] = [];
      effects.syncSessionResumeToTracking$.subscribe((action) => {
        dispatchedActions.push(action);
      });

      // Action: Resume the break
      actions$.next(actions.unPauseFocusSession());
      tick(10);

      // Verify: clearResumingBreakFlag dispatched (not setCurrentTask)
      expect(dispatchedActions.length).toBe(1);
      expect(dispatchedActions[0].type).toBe(actions.clearResumingBreakFlag.type);

      flush();
    }));

    it('should skip break when user manually starts tracking after pause/resume with isPauseTrackingDuringBreak', fakeAsync(() => {
      // Setup: Break is running, isPauseTrackingDuringBreak = true, _isResumingBreak = false
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isPauseTrackingDuringBreak: true,
      });

      const runningBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: true,
        elapsed: 2 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      store.overrideSelector(selectors.selectTimer, runningBreakTimer);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');
      store.overrideSelector(selectors.selectIsResumingBreak, false);

      const dispatchedActions: Action[] = [];
      effects.syncTrackingStartToSession$.subscribe((action) => {
        dispatchedActions.push(action);
      });

      // Action: User manually starts tracking during break
      currentTaskId$.next('test-task-id');
      tick(10);

      // Verify: skipBreak dispatched (not clearResumingBreakFlag)
      expect(dispatchedActions.length).toBe(1);
      expect(dispatchedActions[0].type).toBe(actions.skipBreak.type);

      flush();
    }));

    it('full lifecycle: resume break dispatches clearResumingBreakFlag, then manual tracking dispatches skipBreak', fakeAsync(() => {
      // This integration test verifies the complete bug #6534 scenario:
      // Without the fix, step 2 would dispatch clearResumingBreakFlag instead of skipBreak.
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: true,
        isPauseTrackingDuringBreak: true,
      });

      const pausedBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: false,
        elapsed: 2 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      store.overrideSelector(selectors.selectTimer, pausedBreakTimer);
      store.overrideSelector(selectors.selectMode, FocusModeMode.Pomodoro);
      store.overrideSelector(selectors.selectCurrentScreen, FocusScreen.Main);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');
      store.overrideSelector(selectors.selectIsResumingBreak, false);
      currentTaskId$.next(null);

      const resumeActions: Action[] = [];
      const trackingActions: Action[] = [];

      effects.syncSessionResumeToTracking$.subscribe((action) => {
        resumeActions.push(action);
        // Simulate reducer: clearResumingBreakFlag clears the flag
        if (action.type === actions.clearResumingBreakFlag.type) {
          store.overrideSelector(selectors.selectIsResumingBreak, false);
          store.refreshState();
        }
      });

      effects.syncTrackingStartToSession$.subscribe((action) => {
        trackingActions.push(action);
      });

      // Step 1: Resume break (reducer sets _isResumingBreak = true)
      store.overrideSelector(selectors.selectIsResumingBreak, true);
      store.overrideSelector(
        selectors.selectTimer,
        createMockTimer({
          purpose: 'break',
          isRunning: true,
          elapsed: 2 * 60 * 1000,
          duration: 5 * 60 * 1000,
        }),
      );
      store.refreshState();
      actions$.next(actions.unPauseFocusSession());
      tick(10);

      // Verify step 1: effect dispatched clearResumingBreakFlag
      expect(resumeActions.length).toBe(1);
      expect(resumeActions[0].type).toBe(actions.clearResumingBreakFlag.type);

      // Step 2: User manually starts tracking during break
      // _isResumingBreak is now false (cleared by subscribe callback above)
      currentTaskId$.next('test-task-id');
      tick(10);

      // Verify step 2: skipBreak dispatched (NOT clearResumingBreakFlag)
      expect(trackingActions.length).toBe(1);
      expect(trackingActions[0].type).toBe(actions.skipBreak.type);

      flush();
    }));
  });

  describe('syncSessionResumeToTracking$', () => {
    it('should resume tracking when break is paused and unPauseFocusSession is dispatched', fakeAsync(() => {
      // Setup: Paused break with pausedTaskId, tracking stopped
      const pausedBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: false,
        elapsed: 2 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      store.overrideSelector(selectors.selectTimer, pausedBreakTimer);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');

      currentTaskId$.next(null); // Tracking is stopped

      const dispatchedActions: Action[] = [];
      effects.syncSessionResumeToTracking$.subscribe((action) => {
        dispatchedActions.push(action);
      });

      // Action: Resume the break
      actions$.next(actions.unPauseFocusSession());
      tick(10);

      // Verify: setCurrentTask was dispatched to resume tracking
      expect(dispatchedActions.length).toBe(1);
      expect(dispatchedActions[0].type).toBe(setCurrentTask.type);
      expect((dispatchedActions[0] as any).id).toBe('test-task-id');

      flush();
    }));

    it('should NOT resume tracking if tracking is already active', fakeAsync(() => {
      // Setup: Paused break but tracking is already running
      const pausedBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: false,
        elapsed: 2 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      store.overrideSelector(selectors.selectTimer, pausedBreakTimer);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');

      currentTaskId$.next('test-task-id'); // Tracking already running

      const dispatchedActions: Action[] = [];
      effects.syncSessionResumeToTracking$.subscribe((action) => {
        dispatchedActions.push(action);
      });

      // Action: Resume the break
      actions$.next(actions.unPauseFocusSession());
      tick(10);

      // Verify: NO action dispatched (tracking already active)
      expect(dispatchedActions.length).toBe(0);

      flush();
    }));

    it('should NOT resume tracking if sync is disabled', fakeAsync(() => {
      // Setup: Sync disabled
      store.overrideSelector(selectFocusModeConfig, {
        isSkipPreparation: false,
        isSyncSessionWithTracking: false,
        isPauseTrackingDuringBreak: false,
      });

      const pausedBreakTimer = createMockTimer({
        purpose: 'break',
        isRunning: false,
        elapsed: 2 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      store.overrideSelector(selectors.selectTimer, pausedBreakTimer);
      store.overrideSelector(selectors.selectPausedTaskId, 'test-task-id');
      currentTaskId$.next(null);

      const dispatchedActions: Action[] = [];
      effects.syncSessionResumeToTracking$.subscribe((action) => {
        dispatchedActions.push(action);
      });

      // Action: Resume the break
      actions$.next(actions.unPauseFocusSession());
      tick(10);

      // Verify: NO action dispatched (sync disabled)
      expect(dispatchedActions.length).toBe(0);

      flush();
    }));
  });
});
