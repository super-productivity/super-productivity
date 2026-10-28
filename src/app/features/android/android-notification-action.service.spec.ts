import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of } from 'rxjs';
import {
  AndroidNotificationActionService,
  NOTIFICATION_ACTION_ANDROID_INTERFACE,
  parseFocusActionQueue,
  parseTrackingActionQueue,
} from './android-notification-action.service';
import { TaskService } from '../tasks/task.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { selectCurrentTaskId } from '../tasks/store/task.selectors';
import {
  selectPausedTaskId,
  selectTimer,
} from '../focus-mode/store/focus-mode.selectors';
import { TimerState } from '../focus-mode/focus-mode.model';
import * as focusModeActions from '../focus-mode/store/focus-mode.actions';
import { createTask } from '../tasks/task.test-helper';
import { ANDROID_BACKGROUND_TICK_CAP_MS } from '../../app.constants';
import { Task } from '../tasks/task.model';

const MIN = 60_000;
const FIVE_MIN = 5 * MIN;
const IDLE_TIMER: TimerState = {
  isRunning: false,
  startedAt: null,
  elapsed: 0,
  duration: 0,
  purpose: null,
};
const workTimer = (over: Partial<TimerState> = {}): TimerState => ({
  isRunning: true,
  startedAt: Date.now() - FIVE_MIN,
  elapsed: 5 * MIN,
  duration: 25 * MIN,
  purpose: 'work',
  ...over,
});

describe('parseTrackingActionQueue', () => {
  it('returns valid entries and drops malformed ones', () => {
    const raw = JSON.stringify([
      { type: 'PAUSE', taskId: 't1', elapsedMs: 1000, at: 5 },
      { type: 'DONE', taskId: 't2', elapsedMs: 2000, at: 6 },
      { type: 'STOP', taskId: 't3', elapsedMs: 1, at: 1 },
      { type: 'PAUSE', taskId: '', elapsedMs: 1, at: 1 },
      { type: 'PAUSE', taskId: 't4', elapsedMs: 'x', at: 1 },
      null,
    ]);
    expect(parseTrackingActionQueue(raw)).toEqual([
      { type: 'PAUSE', taskId: 't1', elapsedMs: 1000, at: 5 },
      { type: 'DONE', taskId: 't2', elapsedMs: 2000, at: 6 },
    ]);
  });

  it('returns an empty list for empty, invalid or non-array input', () => {
    expect(parseTrackingActionQueue(null)).toEqual([]);
    expect(parseTrackingActionQueue(undefined)).toEqual([]);
    expect(parseTrackingActionQueue('{nope')).toEqual([]);
    expect(parseTrackingActionQueue('{"type":"PAUSE"}')).toEqual([]);
  });
});

describe('parseFocusActionQueue', () => {
  it('returns valid entries and drops malformed ones', () => {
    const raw = JSON.stringify([
      { type: 'PAUSE', at: 1 },
      { type: 'RESUME', at: 2 },
      { type: 'SKIP', at: 3 },
      { type: 'COMPLETE', at: 4 },
      { type: 'CANCEL', at: 5 },
      { type: 'PAUSE' },
    ]);
    expect(parseFocusActionQueue(raw).map((a) => a.type)).toEqual([
      'PAUSE',
      'RESUME',
      'SKIP',
      'COMPLETE',
    ]);
  });
});

describe('AndroidNotificationActionService', () => {
  let store: MockStore;
  let native: {
    getTrackingActionQueue: jasmine.Spy;
    getFocusActionQueue: jasmine.Spy;
    getFocusModeElapsed: jasmine.Spy;
  };
  let taskService: jasmine.SpyObj<TaskService>;
  let globalTracking: jasmine.SpyObj<GlobalTrackingIntervalService>;
  let writeFlush: jasmine.SpyObj<OperationWriteFlushService>;
  let isAllDataLoaded$: BehaviorSubject<boolean>;
  let tasks: Record<string, Task>;
  let calls: string[];

  const setup = (
    state: {
      timer?: TimerState;
      currentTaskId?: string | null;
      pausedTaskId?: string | null;
    } = {},
  ): AndroidNotificationActionService => {
    TestBed.configureTestingModule({
      providers: [
        AndroidNotificationActionService,
        provideMockStore({
          selectors: [
            { selector: selectTimer, value: state.timer ?? IDLE_TIMER },
            { selector: selectCurrentTaskId, value: state.currentTaskId ?? null },
            { selector: selectPausedTaskId, value: state.pausedTaskId ?? null },
          ],
        }),
        { provide: NOTIFICATION_ACTION_ANDROID_INTERFACE, useValue: native },
        { provide: TaskService, useValue: taskService },
        { provide: GlobalTrackingIntervalService, useValue: globalTracking },
        { provide: OperationWriteFlushService, useValue: writeFlush },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: isAllDataLoaded$ },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    return TestBed.inject(AndroidNotificationActionService);
  };

  beforeEach(() => {
    calls = [];
    tasks = {};
    isAllDataLoaded$ = new BehaviorSubject<boolean>(true);
    native = {
      getTrackingActionQueue: jasmine.createSpy('getTrackingActionQueue'),
      getFocusActionQueue: jasmine.createSpy('getFocusActionQueue'),
      getFocusModeElapsed: jasmine
        .createSpy('getFocusModeElapsed')
        .and.returnValue('null'),
    };
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'flushAccumulatedTimeSpent',
      'pauseCurrent',
      'getByIdOnce$',
      'addTimeSpentAndSync',
      'setDone',
    ]);
    taskService.getByIdOnce$.and.callFake((id: string) => of(tasks[id]));
    taskService.flushAccumulatedTimeSpent.and.callFake(() => {
      calls.push('flush');
    });
    taskService.pauseCurrent.and.callFake(() => {
      calls.push('pauseCurrent');
    });
    taskService.addTimeSpentAndSync.and.callFake(() => {
      calls.push('addTimeSpentAndSync');
    });
    globalTracking = jasmine.createSpyObj<GlobalTrackingIntervalService>(
      'GlobalTrackingIntervalService',
      ['triggerWakeUpTickUntil'],
    );
    globalTracking.triggerWakeUpTickUntil.and.callFake(() => {
      calls.push('tickUntil');
      return { duration: 0, date: '2026-10-10', timestamp: Date.now() };
    });
    writeFlush = jasmine.createSpyObj<OperationWriteFlushService>(
      'OperationWriteFlushService',
      ['flushPendingWrites'],
    );
    writeFlush.flushPendingWrites.and.resolveTo();
  });

  describe('tracking actions', () => {
    it('does nothing before all data is loaded', async () => {
      isAllDataLoaded$.next(false);
      const service = setup();
      await service.drain();
      expect(native.getTrackingActionQueue).not.toHaveBeenCalled();
      expect(native.getFocusActionQueue).not.toHaveBeenCalled();
    });

    it('pauses the current task at the tap and credits the native-only remainder', async () => {
      tasks.t1 = createTask({ id: 't1', timeSpent: 10 * MIN });
      native.getTrackingActionQueue.and.returnValue(
        JSON.stringify([{ type: 'PAUSE', taskId: 't1', elapsedMs: 12 * MIN, at: 1234 }]),
      );
      const service = setup({ currentTaskId: 't1' });

      const done = service.drain();
      // Synchronous part: settled before drain() returns.
      expect(calls).toEqual(['tickUntil', 'flush', 'pauseCurrent']);
      expect(globalTracking.triggerWakeUpTickUntil).toHaveBeenCalledWith(
        1234,
        ANDROID_BACKGROUND_TICK_CAP_MS,
      );

      await done;
      expect(taskService.addTimeSpentAndSync).toHaveBeenCalledOnceWith(tasks.t1, 2 * MIN);
      expect(taskService.setDone).not.toHaveBeenCalled();
      expect(writeFlush.flushPendingWrites).toHaveBeenCalled();
    });

    it('credits and marks done a task that is not current (cold start)', async () => {
      tasks.t1 = createTask({ id: 't1', timeSpent: 10 * MIN });
      native.getTrackingActionQueue.and.returnValue(
        JSON.stringify([{ type: 'DONE', taskId: 't1', elapsedMs: 15 * MIN, at: 1 }]),
      );
      const service = setup({ currentTaskId: null });

      await service.drain();
      expect(taskService.pauseCurrent).not.toHaveBeenCalled();
      expect(globalTracking.triggerWakeUpTickUntil).not.toHaveBeenCalled();
      expect(taskService.addTimeSpentAndSync).toHaveBeenCalledOnceWith(tasks.t1, 5 * MIN);
      expect(taskService.setDone).toHaveBeenCalledOnceWith('t1');
    });

    it('does not credit when the store is already ahead of the native total', async () => {
      tasks.t1 = createTask({ id: 't1', timeSpent: 20 * MIN });
      native.getTrackingActionQueue.and.returnValue(
        JSON.stringify([{ type: 'PAUSE', taskId: 't1', elapsedMs: 15 * MIN, at: 1 }]),
      );
      const service = setup();

      await service.drain();
      expect(taskService.addTimeSpentAndSync).not.toHaveBeenCalled();
    });

    it('skips an action whose task no longer exists', async () => {
      native.getTrackingActionQueue.and.returnValue(
        JSON.stringify([{ type: 'DONE', taskId: 'gone', elapsedMs: 15 * MIN, at: 1 }]),
      );
      const service = setup();

      await service.drain();
      expect(taskService.addTimeSpentAndSync).not.toHaveBeenCalled();
      expect(taskService.setDone).not.toHaveBeenCalled();
    });
  });

  describe('focus actions', () => {
    const queue = (...types: string[]): string =>
      JSON.stringify(types.map((type, i) => ({ type, at: 1000 + i })));

    it('leaves the queue for recovery while the native session is not adopted yet', () => {
      native.getFocusModeElapsed.and.returnValue('{"durationMs":1}');
      const service = setup({ timer: IDLE_TIMER });

      service.drainFocus();
      expect(native.getFocusActionQueue).not.toHaveBeenCalled();
    });

    it('drops stale actions when there is no session anywhere', () => {
      native.getFocusActionQueue.and.returnValue(queue('COMPLETE'));
      const service = setup({ timer: IDLE_TIMER });

      service.drainFocus();
      expect(native.getFocusActionQueue).toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('pauses a running work session, crediting ticks up to the tap', () => {
      native.getFocusActionQueue.and.returnValue(queue('PAUSE'));
      const timer = workTimer();
      const service = setup({ timer, currentTaskId: 't1' });

      service.drainFocus();
      expect(globalTracking.triggerWakeUpTickUntil).toHaveBeenCalledWith(
        1000,
        jasmine.any(Number),
      );
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        focusModeActions.pauseFocusSession({ pausedTaskId: 't1' }),
      );
    });

    it('resumes a paused session', () => {
      native.getFocusActionQueue.and.returnValue(queue('RESUME'));
      const service = setup({ timer: workTimer({ isRunning: false }) });

      service.drainFocus();
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        focusModeActions.unPauseFocusSession(),
      );
    });

    it('skips a break', () => {
      native.getFocusActionQueue.and.returnValue(queue('SKIP'));
      const service = setup({
        timer: workTimer({ purpose: 'break' }),
        pausedTaskId: 't1',
      });

      service.drainFocus();
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        focusModeActions.skipBreak({ pausedTaskId: 't1' }),
      );
    });

    it('ignores SKIP outside a break and COMPLETE outside a work session', () => {
      native.getFocusActionQueue.and.returnValue(queue('SKIP'));
      setup({ timer: workTimer() }).drainFocus();
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('after recovery ignores PAUSE/RESUME (already applied natively) but completes', () => {
      native.getFocusActionQueue.and.returnValue(queue('PAUSE', 'RESUME', 'COMPLETE'));
      // The native timer froze at the Complete tap, so the restored session is paused.
      const service = setup({
        timer: workTimer({ isRunning: false, elapsed: 7 * MIN }),
      });

      service.drainFocus(true);
      expect(globalTracking.triggerWakeUpTickUntil).not.toHaveBeenCalled();
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        focusModeActions.completeFocusSession({
          isManual: true,
          completedDuration: 7 * MIN,
        }),
      );
    });

    it('after recovery drops a COMPLETE that a later RESUME superseded', () => {
      native.getFocusActionQueue.and.returnValue(queue('COMPLETE', 'RESUME'));
      const service = setup({ timer: workTimer() });

      service.drainFocus(true);
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('completes a running session with the ticks up to the tap, capped at the duration', () => {
      native.getFocusActionQueue.and.returnValue(queue('COMPLETE'));
      globalTracking.triggerWakeUpTickUntil.and.returnValue({
        duration: 30 * MIN,
        date: '2026-10-10',
        timestamp: Date.now(),
      });
      const service = setup({ timer: workTimer({ elapsed: 5 * MIN }) });

      service.drainFocus();
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        focusModeActions.completeFocusSession({
          isManual: true,
          completedDuration: 25 * MIN,
        }),
      );
    });
  });
});
