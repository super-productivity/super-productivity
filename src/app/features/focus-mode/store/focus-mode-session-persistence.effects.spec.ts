import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subscription } from 'rxjs';
import { MOBILE_BACKGROUND_IDLE_CAP_MS } from '../../../app.constants';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import {
  selectCurrentTaskId,
  selectTaskEntities,
} from '../../tasks/store/task.selectors';
import { TaskService } from '../../tasks/task.service';
import { FocusModeMode, FocusModeState, TimerState } from '../focus-mode.model';
import {
  FocusModeStorageService,
  FocusSessionSnapshot,
} from '../focus-mode-storage.service';
import { FocusModeSessionPersistenceEffects } from './focus-mode-session-persistence.effects';
import { restoreFocusSession } from './focus-mode.actions';
import { initialState } from './focus-mode.reducer';
import { selectFocusModeState } from './focus-mode.selectors';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const POMODORO = 25 * MINUTE;

const workTimer = (overrides: Partial<TimerState> = {}): TimerState => ({
  isRunning: true,
  startedAt: NOW - 5 * MINUTE,
  elapsed: 5 * MINUTE,
  duration: POMODORO,
  purpose: 'work',
  ...overrides,
});

const snapshotOf = (
  overrides: Partial<FocusSessionSnapshot> = {},
): FocusSessionSnapshot => ({
  timer: workTimer(),
  mode: FocusModeMode.Pomodoro,
  currentCycle: 2,
  pausedTaskId: null,
  trackedTaskId: 'task1',
  savedAt: NOW - MINUTE,
  ...overrides,
});

describe('FocusModeSessionPersistenceEffects', () => {
  let store: MockStore;
  let storage: jasmine.SpyObj<FocusModeStorageService>;
  let taskService: jasmine.SpyObj<TaskService>;
  let tracking: jasmine.SpyObj<GlobalTrackingIntervalService>;
  let dispatchSpy: jasmine.Spy;
  let sub: Subscription | undefined;

  const run = (
    snapshot: FocusSessionSnapshot | null,
    opts: { state?: FocusModeState; isTaskDone?: boolean } = {},
  ): void => {
    storage.getSessionSnapshot.and.returnValue(snapshot);
    store.overrideSelector(selectFocusModeState, opts.state ?? initialState);
    store.overrideSelector(selectTaskEntities, {
      task1: { id: 'task1', isDone: !!opts.isTaskDone },
    } as unknown as ReturnType<typeof selectTaskEntities.projector>);
    store.overrideSelector(selectCurrentTaskId, null);
    store.refreshState();
    sub = TestBed.inject(
      FocusModeSessionPersistenceEffects,
    ).restoreThenPersist$.subscribe();
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(NOW));
    storage = jasmine.createSpyObj('FocusModeStorageService', [
      'getSessionSnapshot',
      'setSessionSnapshot',
      'clearSessionSnapshot',
    ]);
    taskService = jasmine.createSpyObj('TaskService', ['setCurrentId']);
    tracking = jasmine.createSpyObj('GlobalTrackingIntervalService', [
      'resetTrackingStart',
    ]);
    TestBed.configureTestingModule({
      providers: [
        FocusModeSessionPersistenceEffects,
        provideMockStore(),
        { provide: FocusModeStorageService, useValue: storage },
        { provide: TaskService, useValue: taskService },
        { provide: GlobalTrackingIntervalService, useValue: tracking },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
  });

  afterEach(() => {
    sub?.unsubscribe();
    jasmine.clock().uninstall();
  });

  it('restores a running work session and resumes tracking without the away gap', () => {
    run(snapshotOf());

    expect(dispatchSpy).toHaveBeenCalledWith(
      restoreFocusSession({
        timer: workTimer(),
        mode: FocusModeMode.Pomodoro,
        currentCycle: 2,
        pausedTaskId: null,
      }),
    );
    expect(tracking.resetTrackingStart).toHaveBeenCalledBefore(taskService.setCurrentId);
    expect(taskService.setCurrentId).toHaveBeenCalledWith('task1');
  });

  it('pins the start of a session that ended while away to its real length', () => {
    run(snapshotOf({ timer: workTimer({ startedAt: NOW - 40 * MINUTE }) }));

    const { timer } = dispatchSpy.calls.mostRecent().args[0];
    expect(timer.startedAt).toBe(NOW - POMODORO);
    expect(taskService.setCurrentId).not.toHaveBeenCalled();
  });

  it('restores a paused session as is and does not resume tracking', () => {
    const paused = workTimer({ isRunning: false, startedAt: NOW - 40 * MINUTE });
    run(snapshotOf({ timer: paused, pausedTaskId: 'task1' }));

    expect(dispatchSpy.calls.mostRecent().args[0].timer).toEqual(paused);
    expect(taskService.setCurrentId).not.toHaveBeenCalled();
  });

  it('restores a break without tracking the task', () => {
    run(snapshotOf({ timer: workTimer({ purpose: 'break', duration: 5 * MINUTE }) }));

    expect(dispatchSpy).toHaveBeenCalled();
    expect(taskService.setCurrentId).not.toHaveBeenCalled();
  });

  it('never pins a Flowtime session, which has no duration', () => {
    const flow = workTimer({ duration: 0, startedAt: NOW - 3 * 60 * MINUTE });
    run(snapshotOf({ timer: flow, mode: FocusModeMode.Flowtime }));

    expect(dispatchSpy.calls.mostRecent().args[0].timer).toEqual(flow);
    expect(taskService.setCurrentId).toHaveBeenCalledWith('task1');
  });

  it('does not track a task that was done meanwhile', () => {
    run(snapshotOf(), { isTaskDone: true });

    expect(dispatchSpy).toHaveBeenCalled();
    expect(taskService.setCurrentId).not.toHaveBeenCalled();
  });

  it('drops a session saved longer ago than the idle cap', () => {
    run(snapshotOf({ savedAt: NOW - MOBILE_BACKGROUND_IDLE_CAP_MS - 1 }));

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('does not overwrite a session that is already active', () => {
    run(snapshotOf(), { state: { ...initialState, timer: workTimer() } });

    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
