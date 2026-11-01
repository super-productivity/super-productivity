import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { LocalRestApiFocusRoutesService } from './local-rest-api-focus-routes.service';
import { LocalRestApiResponsePayload } from '../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  FocusModeMode,
  FocusModeState,
  FocusScreen,
  TimerState,
} from './focus-mode.model';
import * as focusModeActions from './store/focus-mode.actions';
import * as focusModeSelectors from './store/focus-mode.selectors';
import {
  focusModeReducer,
  initialState as initialFocusModeState,
} from './store/focus-mode.reducer';

describe('LocalRestApiFocusRoutesService', () => {
  let service: LocalRestApiFocusRoutesService;
  let store: MockStore;

  const setFocusState = (
    overrides: Partial<Omit<FocusModeState, 'timer'>> & {
      timer?: Partial<TimerState>;
    } = {},
  ): void => {
    const { timer: timerOverrides, ...stateOverrides } = overrides;
    store.setState({
      focusMode: {
        ...initialFocusModeState,
        ...stateOverrides,
        timer: { ...initialFocusModeState.timer, ...timerOverrides },
      },
    });
  };

  beforeEach(() => {
    // Specs that call `store.overrideSelector()` without `resetSelectors()`
    // leak into this file: `overrideSelector` runs `setResult()` on the
    // memoized selector ITSELF - a module singleton shared by the whole Karma
    // context - and `resetSelectors()` only clears what its own store instance
    // registered. These specs read focus-mode state through those selectors,
    // so a leaked result makes them assert against a frozen timer instead of
    // the state they set (jasmine randomizes spec order, so it only fails in
    // some runs). Release them before the store is built, so any override this
    // file's own `provideMockStore` sets up survives.
    Object.values(focusModeSelectors).forEach((selector) => {
      if (typeof selector === 'function' && 'release' in selector) {
        selector.release();
        selector.clearResult();
      }
    });

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiFocusRoutesService,
        provideMockStore({ initialState: { focusMode: initialFocusModeState } }),
      ],
    });

    service = TestBed.inject(LocalRestApiFocusRoutesService);
    store = TestBed.inject(MockStore);
  });

  it('should leave other requests to the other route providers', async () => {
    for (const [method, path] of [
      ['POST', '/focus'],
      ['GET', '/focus/timer'],
      ['GET', '/tasks'],
    ]) {
      expect(
        await service.handle({
          requestId: 'r',
          method,
          path,
          query: {},
          body: undefined,
        }),
      )
        .withContext(`${method} ${path}`)
        .toBeUndefined();
    }
  });

  describe('GET /focus', () => {
    const requestFocus = async (): Promise<LocalRestApiResponsePayload> => {
      const response = await service.handle({
        requestId: 'test-request-id',
        method: 'GET',
        path: '/focus',
        query: {},
        body: undefined,
      });
      if (!response) {
        throw new Error('GET /focus was not answered');
      }
      return response;
    };

    const expectFocusData = (
      response: LocalRestApiResponsePayload,
      expected: unknown,
    ): void => {
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      if (!response.body.ok) {
        throw new Error(`Expected success response, got ${response.body.error.code}`);
      }
      expect(response.body.data).toEqual(expected);
    };

    it('should return a null timer while focus mode is idle', async () => {
      setFocusState({ mode: FocusModeMode.Countdown });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Countdown,
        cycle: 1,
        isSessionDone: false,
        timer: null,
      });
    });

    it('should return a running Pomodoro work timer', async () => {
      setFocusState({
        timer: {
          isRunning: true,
          startedAt: 1,
          elapsed: 120_000,
          duration: 1_500_000,
          purpose: 'work',
        },
        mode: FocusModeMode.Pomodoro,
        currentCycle: 2,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Pomodoro,
        cycle: 2,
        isSessionDone: false,
        timer: {
          purpose: 'work',
          status: 'running',
          isOvertime: false,
          elapsedMs: 120_000,
          remainingMs: 1_380_000,
          durationMs: 1_500_000,
          isLongBreak: false,
        },
      });
    });

    it('should return a paused Countdown work timer', async () => {
      setFocusState({
        timer: {
          isRunning: false,
          startedAt: 1,
          elapsed: 90_000,
          duration: 300_000,
          purpose: 'work',
        },
        mode: FocusModeMode.Countdown,
        currentCycle: 1,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Countdown,
        cycle: 1,
        isSessionDone: false,
        timer: {
          purpose: 'work',
          status: 'paused',
          isOvertime: false,
          elapsedMs: 90_000,
          remainingMs: 210_000,
          durationMs: 300_000,
          isLongBreak: false,
        },
      });
    });

    it('should return a running Countdown work timer', async () => {
      setFocusState({
        timer: {
          isRunning: true,
          startedAt: 1,
          elapsed: 90_000,
          duration: 300_000,
          purpose: 'work',
        },
        mode: FocusModeMode.Countdown,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Countdown,
        cycle: 1,
        isSessionDone: false,
        timer: {
          purpose: 'work',
          status: 'running',
          isOvertime: false,
          elapsedMs: 90_000,
          remainingMs: 210_000,
          durationMs: 300_000,
          isLongBreak: false,
        },
      });
    });

    it('should return a completed work session separately from the timer', async () => {
      setFocusState({
        currentScreen: FocusScreen.SessionDone,
        mode: FocusModeMode.Countdown,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Countdown,
        cycle: 1,
        isSessionDone: true,
        timer: null,
      });
    });

    it('should return running short and long Pomodoro breaks', async () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: 1,
        elapsed: 30_000,
        duration: 300_000,
        purpose: 'break',
      };

      setFocusState({ timer, mode: FocusModeMode.Pomodoro, currentCycle: 2 });
      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Pomodoro,
        cycle: 2,
        isSessionDone: false,
        timer: {
          purpose: 'break',
          status: 'running',
          isOvertime: false,
          elapsedMs: 30_000,
          remainingMs: 270_000,
          durationMs: 300_000,
          isLongBreak: false,
        },
      });

      setFocusState({
        timer: { ...timer, isLongBreak: true },
        mode: FocusModeMode.Pomodoro,
        currentCycle: 5,
      });
      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Pomodoro,
        cycle: 5,
        isSessionDone: false,
        timer: {
          purpose: 'break',
          status: 'running',
          isOvertime: false,
          elapsedMs: 30_000,
          remainingMs: 270_000,
          durationMs: 300_000,
          isLongBreak: true,
        },
      });
    });

    it('should return a completed Pomodoro break as done', async () => {
      setFocusState({
        timer: {
          isRunning: false,
          startedAt: 1,
          elapsed: 300_000,
          duration: 300_000,
          purpose: 'break',
          isLongBreak: true,
        },
        mode: FocusModeMode.Pomodoro,
        currentCycle: 5,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Pomodoro,
        cycle: 5,
        isSessionDone: false,
        timer: {
          purpose: 'break',
          status: 'done',
          isOvertime: false,
          elapsedMs: 300_000,
          remainingMs: 0,
          durationMs: 300_000,
          isLongBreak: true,
        },
      });
    });

    it('should return a stopped Pomodoro break with time remaining as paused', async () => {
      setFocusState({
        timer: {
          isRunning: false,
          startedAt: 1,
          elapsed: 30_000,
          duration: 300_000,
          purpose: 'break',
          isLongBreak: true,
        },
        mode: FocusModeMode.Pomodoro,
        currentCycle: 5,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Pomodoro,
        cycle: 5,
        isSessionDone: false,
        timer: {
          purpose: 'break',
          status: 'paused',
          isOvertime: false,
          elapsedMs: 30_000,
          remainingMs: 270_000,
          durationMs: 300_000,
          isLongBreak: true,
        },
      });
    });

    it('should return running and paused Flowtime work timers', async () => {
      setFocusState({
        timer: {
          isRunning: true,
          startedAt: 1,
          elapsed: 600_000,
          duration: 0,
          purpose: 'work',
        },
        mode: FocusModeMode.Flowtime,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Flowtime,
        cycle: 1,
        isSessionDone: false,
        timer: {
          purpose: 'work',
          status: 'running',
          isOvertime: false,
          elapsedMs: 600_000,
          remainingMs: 0,
          durationMs: 0,
          isLongBreak: false,
        },
      });

      setFocusState({
        timer: {
          isRunning: false,
          startedAt: 1,
          elapsed: 600_000,
          duration: 0,
          purpose: 'work',
        },
        mode: FocusModeMode.Flowtime,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Flowtime,
        cycle: 1,
        isSessionDone: false,
        timer: {
          purpose: 'work',
          status: 'paused',
          isOvertime: false,
          elapsedMs: 600_000,
          remainingMs: 0,
          durationMs: 0,
          isLongBreak: false,
        },
      });
    });

    it('should retain the Pomodoro cycle after switching to Flowtime', async () => {
      const flowtimeState = focusModeReducer(
        {
          ...initialFocusModeState,
          mode: FocusModeMode.Pomodoro,
          currentCycle: 5,
          timer: {
            isRunning: true,
            startedAt: 1,
            elapsed: 600_000,
            duration: 1_500_000,
            purpose: 'work',
          },
        },
        focusModeActions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
      );
      store.setState({ focusMode: flowtimeState });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Flowtime,
        cycle: 5,
        isSessionDone: false,
        timer: {
          purpose: 'work',
          status: 'running',
          isOvertime: false,
          elapsedMs: 600_000,
          remainingMs: 0,
          durationMs: 0,
          isLongBreak: false,
        },
      });
    });

    it('should preserve overtime while a work timer is paused', async () => {
      setFocusState({
        timer: {
          isRunning: false,
          startedAt: 1,
          elapsed: 1_600_000,
          duration: 1_500_000,
          purpose: 'work',
        },
        mode: FocusModeMode.Pomodoro,
        _isOvertimeEnabled: true,
      });

      expectFocusData(await requestFocus(), {
        mode: FocusModeMode.Pomodoro,
        cycle: 1,
        isSessionDone: false,
        timer: {
          purpose: 'work',
          status: 'paused',
          isOvertime: true,
          elapsedMs: 1_600_000,
          remainingMs: 0,
          durationMs: 1_500_000,
          isLongBreak: false,
        },
      });
    });
  });
});
