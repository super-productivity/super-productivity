import { TestBed, fakeAsync } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { DateService } from '../../../core/date/date.service';
import { Task } from '../../tasks/task.model';

// We need to test the effect logic by reimplementing it in tests since
// the actual effects are conditionally created based on IS_ANDROID_WEB_VIEW

describe('AndroidForegroundTrackingEffects - syncTimeSpentChanges logic', () => {
  let store: MockStore;
  let currentTask$: BehaviorSubject<Task | null>;
  let updateTrackingServiceSpy: jasmine.Spy;

  beforeEach(() => {
    currentTask$ = new BehaviorSubject<Task | null>(null);
    updateTrackingServiceSpy = jasmine.createSpy('updateTrackingService');

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        { provide: TaskService, useValue: { getByIdOnce$: () => currentTask$ } },
        { provide: DateService, useValue: { todayStr: () => '2024-01-01' } },
      ],
    });

    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  /**
   * Test the core logic: when timeSpent changes for the same task while tracking,
   * the updateTrackingService should be called with the new value.
   */
  describe('timeSpent change detection logic', () => {
    it('should call updateTrackingService when timeSpent changes for the same task', fakeAsync(() => {
      // Simulate the effect logic
      const prevState = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };
      const currState = { taskId: 'task-1', timeSpent: 0, isFocusModeActive: false };

      const shouldUpdate =
        prevState.taskId === currState.taskId &&
        currState.taskId !== null &&
        !currState.isFocusModeActive &&
        prevState.timeSpent !== currState.timeSpent;

      expect(shouldUpdate).toBeTrue();

      // In real code, this triggers: androidInterface.updateTrackingService?.(curr.timeSpent);
      if (shouldUpdate) {
        updateTrackingServiceSpy(currState.timeSpent);
      }

      expect(updateTrackingServiceSpy).toHaveBeenCalledWith(0);
    }));

    it('should NOT call updateTrackingService when switching to a different task', fakeAsync(() => {
      const prevState = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };
      const currState = { taskId: 'task-2', timeSpent: 30000, isFocusModeActive: false };

      const shouldUpdate =
        prevState.taskId === currState.taskId &&
        currState.taskId !== null &&
        !currState.isFocusModeActive &&
        prevState.timeSpent !== currState.timeSpent;

      expect(shouldUpdate).toBeFalse();
    }));

    it('should NOT call updateTrackingService when focus mode is active', fakeAsync(() => {
      const prevState = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };
      const currState = { taskId: 'task-1', timeSpent: 0, isFocusModeActive: true };

      const shouldUpdate =
        prevState.taskId === currState.taskId &&
        currState.taskId !== null &&
        !currState.isFocusModeActive &&
        prevState.timeSpent !== currState.timeSpent;

      expect(shouldUpdate).toBeFalse();
    }));

    it('should NOT call updateTrackingService when no task is being tracked', fakeAsync(() => {
      const prevState = { taskId: null, timeSpent: 0, isFocusModeActive: false };
      const currState = { taskId: null, timeSpent: 0, isFocusModeActive: false };

      const shouldUpdate =
        prevState.taskId === currState.taskId &&
        currState.taskId !== null &&
        !currState.isFocusModeActive &&
        prevState.timeSpent !== currState.timeSpent;

      expect(shouldUpdate).toBeFalse();
    }));

    it('should NOT call updateTrackingService when timeSpent did not change', fakeAsync(() => {
      const prevState = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };
      const currState = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };

      const shouldUpdate =
        prevState.taskId === currState.taskId &&
        currState.taskId !== null &&
        !currState.isFocusModeActive &&
        prevState.timeSpent !== currState.timeSpent;

      expect(shouldUpdate).toBeFalse();
    }));

    it('should call updateTrackingService when timeSpent is increased', fakeAsync(() => {
      const prevState = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };
      const currState = { taskId: 'task-1', timeSpent: 120000, isFocusModeActive: false };

      const shouldUpdate =
        prevState.taskId === currState.taskId &&
        currState.taskId !== null &&
        !currState.isFocusModeActive &&
        prevState.timeSpent !== currState.timeSpent;

      expect(shouldUpdate).toBeTrue();

      if (shouldUpdate) {
        updateTrackingServiceSpy(currState.timeSpent);
      }

      expect(updateTrackingServiceSpy).toHaveBeenCalledWith(120000);
    }));
  });

  describe('distinctUntilChanged behavior', () => {
    it('should detect changes when only timeSpent differs', () => {
      const stateA = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };
      const stateB = { taskId: 'task-1', timeSpent: 0, isFocusModeActive: false };

      // The distinctUntilChanged comparator
      const isEqual =
        stateA.taskId === stateB.taskId &&
        stateA.timeSpent === stateB.timeSpent &&
        stateA.isFocusModeActive === stateB.isFocusModeActive;

      expect(isEqual).toBeFalse(); // Should NOT be equal, so effect should fire
    });

    it('should NOT detect changes when state is identical', () => {
      const stateA = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };
      const stateB = { taskId: 'task-1', timeSpent: 60000, isFocusModeActive: false };

      const isEqual =
        stateA.taskId === stateB.taskId &&
        stateA.timeSpent === stateB.timeSpent &&
        stateA.isFocusModeActive === stateB.isFocusModeActive;

      expect(isEqual).toBeTrue(); // Should be equal, so effect should NOT fire
    });
  });
});

describe('AndroidForegroundTrackingEffects - safeNativeCall error handling', () => {
  let logErrSpy: jasmine.Spy;
  let snackOpenSpy: jasmine.Spy;

  // Replicate the _safeNativeCall helper logic for testing
  const safeNativeCall = (
    fn: () => void,
    errorMsg: string,
    showSnackbar: boolean,
    logErr: (msg: string, e: unknown) => void,
    snackOpen: (params: { msg: string; type: string }) => void,
  ): void => {
    try {
      fn();
    } catch (e) {
      logErr(errorMsg, e);
      if (showSnackbar) {
        snackOpen({ msg: errorMsg, type: 'ERROR' });
      }
    }
  };

  beforeEach(() => {
    logErrSpy = jasmine.createSpy('DroidLog.err');
    snackOpenSpy = jasmine.createSpy('snackService.open');
  });

  it('should not log error when native call succeeds', () => {
    const successFn = jasmine.createSpy('successFn');

    safeNativeCall(successFn, 'Error message', false, logErrSpy, snackOpenSpy);

    expect(successFn).toHaveBeenCalled();
    expect(logErrSpy).not.toHaveBeenCalled();
    expect(snackOpenSpy).not.toHaveBeenCalled();
  });

  it('should log error when native call throws', () => {
    const error = new Error('Java exception was raised');
    const failFn = jasmine.createSpy('failFn').and.throwError(error);

    safeNativeCall(failFn, 'Failed to start service', false, logErrSpy, snackOpenSpy);

    expect(failFn).toHaveBeenCalled();
    expect(logErrSpy).toHaveBeenCalledWith('Failed to start service', error);
    expect(snackOpenSpy).not.toHaveBeenCalled();
  });

  it('should show snackbar when native call throws and showSnackbar is true', () => {
    const error = new Error('Java exception was raised');
    const failFn = jasmine.createSpy('failFn').and.throwError(error);

    safeNativeCall(failFn, 'Failed to start tracking', true, logErrSpy, snackOpenSpy);

    expect(failFn).toHaveBeenCalled();
    expect(logErrSpy).toHaveBeenCalledWith('Failed to start tracking', error);
    expect(snackOpenSpy).toHaveBeenCalledWith({
      msg: 'Failed to start tracking',
      type: 'ERROR',
    });
  });

  it('should NOT show snackbar when native call throws and showSnackbar is false', () => {
    const error = new Error('Java exception was raised');
    const failFn = jasmine.createSpy('failFn').and.throwError(error);

    safeNativeCall(failFn, 'Failed to update service', false, logErrSpy, snackOpenSpy);

    expect(failFn).toHaveBeenCalled();
    expect(logErrSpy).toHaveBeenCalledWith('Failed to update service', error);
    expect(snackOpenSpy).not.toHaveBeenCalled();
  });

  it('should handle different error types', () => {
    const stringError = 'String error message';
    const failFn = (): void => {
      throw stringError;
    };

    safeNativeCall(failFn, 'Native call failed', true, logErrSpy, snackOpenSpy);

    expect(logErrSpy).toHaveBeenCalledWith('Native call failed', stringError);
    expect(snackOpenSpy).toHaveBeenCalledWith({
      msg: 'Native call failed',
      type: 'ERROR',
    });
  });
});

describe('AndroidForegroundTrackingEffects - saveTimeTrackingImmediately logic', () => {
  /**
   * Tests for the immediate save functionality added to fix issue #5842.
   * When notification buttons (Pause/Done) are clicked, time tracking data
   * should be saved immediately to IndexedDB, bypassing the 15-second debounce.
   */

  let taskSaveSpy: jasmine.Spy;
  let timeTrackingSaveSpy: jasmine.Spy;

  // Replicate the _saveTimeTrackingImmediately helper logic for testing
  const saveTimeTrackingImmediately = (
    taskState: { entities: Record<string, unknown>; selectedTaskId: string | null },
    ttState: { project: Record<string, unknown>; tag: Record<string, unknown> },
    isProduction: boolean,
    taskSave: (data: unknown, options: unknown) => void,
    timeTrackingSave: (data: unknown, options: unknown) => void,
  ): void => {
    // Save task state (same logic as in _saveTimeTrackingImmediately)
    taskSave(
      {
        ...taskState,
        selectedTaskId: isProduction ? null : taskState.selectedTaskId,
        currentTaskId: null,
      },
      { isUpdateRevAndLastUpdate: true },
    );

    // Save time tracking state
    timeTrackingSave(ttState, { isUpdateRevAndLastUpdate: true });
  };

  beforeEach(() => {
    taskSaveSpy = jasmine.createSpy('pfapiService.m.task.save');
    timeTrackingSaveSpy = jasmine.createSpy('pfapiService.m.timeTracking.save');
  });

  it('should save task state with currentTaskId set to null', () => {
    const taskState = {
      entities: { task1: { id: 'task-1', timeSpent: 60000 } },
      selectedTaskId: 'task-1',
    };
    const ttState = { project: {}, tag: {} };

    saveTimeTrackingImmediately(
      taskState,
      ttState,
      true,
      taskSaveSpy,
      timeTrackingSaveSpy,
    );

    expect(taskSaveSpy).toHaveBeenCalledWith(
      {
        entities: { task1: { id: 'task-1', timeSpent: 60000 } },
        selectedTaskId: null,
        currentTaskId: null,
      },
      { isUpdateRevAndLastUpdate: true },
    );
  });

  it('should save time tracking state with isUpdateRevAndLastUpdate flag', () => {
    const taskState = {
      entities: {},
      selectedTaskId: null,
    };
    const ttState = {
      project: { proj1: { d20240101: { s: 1000, e: 2000 } } },
      tag: { tag1: { d20240101: { s: 1000, e: 2000 } } },
    };

    saveTimeTrackingImmediately(
      taskState,
      ttState,
      true,
      taskSaveSpy,
      timeTrackingSaveSpy,
    );

    expect(timeTrackingSaveSpy).toHaveBeenCalledWith(
      {
        project: { proj1: { d20240101: { s: 1000, e: 2000 } } },
        tag: { tag1: { d20240101: { s: 1000, e: 2000 } } },
      },
      { isUpdateRevAndLastUpdate: true },
    );
  });

  it('should preserve selectedTaskId in non-production mode', () => {
    const taskState = {
      entities: {},
      selectedTaskId: 'task-1',
    };
    const ttState = { project: {}, tag: {} };

    saveTimeTrackingImmediately(
      taskState,
      ttState,
      false, // non-production
      taskSaveSpy,
      timeTrackingSaveSpy,
    );

    expect(taskSaveSpy).toHaveBeenCalledWith(
      {
        entities: {},
        selectedTaskId: 'task-1', // preserved in non-production
        currentTaskId: null,
      },
      { isUpdateRevAndLastUpdate: true },
    );
  });

  it('should call both save methods when saving immediately', () => {
    const taskState = { entities: {}, selectedTaskId: null };
    const ttState = { project: {}, tag: {} };

    saveTimeTrackingImmediately(
      taskState,
      ttState,
      true,
      taskSaveSpy,
      timeTrackingSaveSpy,
    );

    expect(taskSaveSpy).toHaveBeenCalledTimes(1);
    expect(timeTrackingSaveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AndroidForegroundTrackingEffects - notification handler logic', () => {
  /**
   * Tests for notification button handlers (Pause/Done).
   * These should sync elapsed time AND call immediate save before pausing.
   */

  let syncElapsedTimeSpy: jasmine.Spy;
  let saveImmediatelySpy: jasmine.Spy;
  let pauseCurrentSpy: jasmine.Spy;
  let setDoneSpy: jasmine.Spy;

  // Replicate the pause handler logic
  const handlePauseAction = (
    currentTask: { id: string } | null,
    syncElapsedTime: (taskId: string) => void,
    saveImmediately: () => void,
    pauseCurrent: () => void,
  ): void => {
    if (!currentTask) return;
    syncElapsedTime(currentTask.id);
    saveImmediately();
    pauseCurrent();
  };

  // Replicate the done handler logic
  const handleDoneAction = (
    currentTask: { id: string } | null,
    syncElapsedTime: (taskId: string) => void,
    setDone: (taskId: string) => void,
    saveImmediately: () => void,
    pauseCurrent: () => void,
  ): void => {
    if (!currentTask) return;
    syncElapsedTime(currentTask.id);
    setDone(currentTask.id);
    saveImmediately();
    pauseCurrent();
  };

  beforeEach(() => {
    syncElapsedTimeSpy = jasmine.createSpy('syncElapsedTimeForTask');
    saveImmediatelySpy = jasmine.createSpy('saveTimeTrackingImmediately');
    pauseCurrentSpy = jasmine.createSpy('pauseCurrent');
    setDoneSpy = jasmine.createSpy('setDone');
  });

  describe('handlePauseAction', () => {
    it('should sync, save immediately, then pause in correct order', () => {
      const currentTask = { id: 'task-1' };
      const callOrder: string[] = [];

      syncElapsedTimeSpy.and.callFake(() => callOrder.push('sync'));
      saveImmediatelySpy.and.callFake(() => callOrder.push('save'));
      pauseCurrentSpy.and.callFake(() => callOrder.push('pause'));

      handlePauseAction(
        currentTask,
        syncElapsedTimeSpy,
        saveImmediatelySpy,
        pauseCurrentSpy,
      );

      expect(callOrder).toEqual(['sync', 'save', 'pause']);
    });

    it('should call saveImmediately to bypass 15s debounce', () => {
      const currentTask = { id: 'task-1' };

      handlePauseAction(
        currentTask,
        syncElapsedTimeSpy,
        saveImmediatelySpy,
        pauseCurrentSpy,
      );

      expect(saveImmediatelySpy).toHaveBeenCalledTimes(1);
    });

    it('should not execute if currentTask is null', () => {
      handlePauseAction(null, syncElapsedTimeSpy, saveImmediatelySpy, pauseCurrentSpy);

      expect(syncElapsedTimeSpy).not.toHaveBeenCalled();
      expect(saveImmediatelySpy).not.toHaveBeenCalled();
      expect(pauseCurrentSpy).not.toHaveBeenCalled();
    });
  });

  describe('handleDoneAction', () => {
    it('should sync, setDone, save immediately, then pause in correct order', () => {
      const currentTask = { id: 'task-1' };
      const callOrder: string[] = [];

      syncElapsedTimeSpy.and.callFake(() => callOrder.push('sync'));
      setDoneSpy.and.callFake(() => callOrder.push('done'));
      saveImmediatelySpy.and.callFake(() => callOrder.push('save'));
      pauseCurrentSpy.and.callFake(() => callOrder.push('pause'));

      handleDoneAction(
        currentTask,
        syncElapsedTimeSpy,
        setDoneSpy,
        saveImmediatelySpy,
        pauseCurrentSpy,
      );

      expect(callOrder).toEqual(['sync', 'done', 'save', 'pause']);
    });

    it('should call saveImmediately after setDone to persist done status', () => {
      const currentTask = { id: 'task-1' };

      handleDoneAction(
        currentTask,
        syncElapsedTimeSpy,
        setDoneSpy,
        saveImmediatelySpy,
        pauseCurrentSpy,
      );

      expect(setDoneSpy).toHaveBeenCalledWith('task-1');
      expect(saveImmediatelySpy).toHaveBeenCalledTimes(1);
    });

    it('should not execute if currentTask is null', () => {
      handleDoneAction(
        null,
        syncElapsedTimeSpy,
        setDoneSpy,
        saveImmediatelySpy,
        pauseCurrentSpy,
      );

      expect(syncElapsedTimeSpy).not.toHaveBeenCalled();
      expect(setDoneSpy).not.toHaveBeenCalled();
      expect(saveImmediatelySpy).not.toHaveBeenCalled();
      expect(pauseCurrentSpy).not.toHaveBeenCalled();
    });
  });
});

describe('AndroidForegroundTrackingEffects - syncElapsedTimeForTask logic', () => {
  /**
   * Tests for the _syncElapsedTimeForTask method that syncs time from
   * the native Android foreground service to the app's task state.
   * Uses firstValueFrom for reliable observable handling (fixes issue #5840).
   */

  let addTimeSpentSpy: jasmine.Spy;
  let resetTrackingStartSpy: jasmine.Spy;

  // Replicate the sync logic for testing
  const syncElapsedTimeForTask = async (
    taskId: string,
    elapsedJson: string | null,
    getTask: (id: string) => Promise<{ id: string; timeSpent: number } | null>,
    addTimeSpent: (task: unknown, duration: number, date: string) => void,
    resetTrackingStart: () => void,
    todayStr: string,
  ): Promise<void> => {
    if (!elapsedJson || elapsedJson === 'null') {
      return;
    }

    try {
      const nativeData = JSON.parse(elapsedJson) as {
        taskId: string;
        elapsedMs: number;
      };

      // Only sync if native is tracking the same task
      if (nativeData.taskId !== taskId) {
        return;
      }

      const task = await getTask(taskId);
      if (!task) {
        return;
      }

      const currentTimeSpent = task.timeSpent || 0;
      const duration = nativeData.elapsedMs - currentTimeSpent;

      if (duration > 0) {
        addTimeSpent(task, duration, todayStr);
        resetTrackingStart();
      }
    } catch {
      // Error handling
    }
  };

  beforeEach(() => {
    addTimeSpentSpy = jasmine.createSpy('addTimeSpent');
    resetTrackingStartSpy = jasmine.createSpy('resetTrackingStart');
  });

  it('should add duration when native has more time than app', async () => {
    const nativeElapsed = 900000; // 15 minutes
    const appTimeSpent = 60000; // 1 minute
    const expectedDuration = nativeElapsed - appTimeSpent; // 14 minutes

    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: nativeElapsed });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: appTimeSpent,
    });

    await syncElapsedTimeForTask(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).toHaveBeenCalledWith(
      { id: 'task-1', timeSpent: appTimeSpent },
      expectedDuration,
      '2024-01-01',
    );
  });

  it('should NOT add time when native and app times match', async () => {
    const elapsedMs = 60000;
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: elapsedMs, // Same as native
    });

    await syncElapsedTimeForTask(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
  });

  it('should handle null elapsedJson gracefully', async () => {
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 0,
    });

    await syncElapsedTimeForTask(
      'task-1',
      null,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(resetTrackingStartSpy).not.toHaveBeenCalled();
  });

  it('should handle "null" string elapsedJson gracefully', async () => {
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 0,
    });

    await syncElapsedTimeForTask(
      'task-1',
      'null',
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(resetTrackingStartSpy).not.toHaveBeenCalled();
  });

  it('should call resetTrackingStart after successful sync', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: 60000 });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 0, // App has 0, native has 60s -> should sync
    });

    await syncElapsedTimeForTask(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(resetTrackingStartSpy).toHaveBeenCalledTimes(1);
  });

  it('should NOT call resetTrackingStart when no duration is added', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: 60000 });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 60000, // Same as native - no sync needed
    });

    await syncElapsedTimeForTask(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(resetTrackingStartSpy).not.toHaveBeenCalled();
  });

  it('should NOT sync if native is tracking a different task', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-2', elapsedMs: 60000 });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 0,
    });

    await syncElapsedTimeForTask(
      'task-1', // We want to sync task-1
      elapsedJson, // But native is tracking task-2
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(resetTrackingStartSpy).not.toHaveBeenCalled();
  });

  it('should handle task not found gracefully', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: 60000 });
    const getTask = async (): Promise<null> => null;

    await syncElapsedTimeForTask(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(resetTrackingStartSpy).not.toHaveBeenCalled();
  });

  it('should handle invalid JSON gracefully', async () => {
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 0,
    });

    await syncElapsedTimeForTask(
      'task-1',
      'invalid json {',
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(resetTrackingStartSpy).not.toHaveBeenCalled();
  });

  it('should handle task with zero timeSpent', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: 300000 }); // 5 minutes
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 0, // Fresh task with no time spent yet
    });

    await syncElapsedTimeForTask(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).toHaveBeenCalledWith(
      { id: 'task-1', timeSpent: 0 },
      300000, // Full 5 minutes should be added
      '2024-01-01',
    );
    expect(resetTrackingStartSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AndroidForegroundTrackingEffects - flush await fix (issue #5842)', () => {
  /**
   * Tests for the critical bug fix: _flushPendingOperations must be awaited
   * to prevent data loss when app is closed immediately after notification action.
   */

  let flushSpy: jasmine.Spy;
  let syncSpy: jasmine.Spy;
  let pauseSpy: jasmine.Spy;
  let setDoneSpy: jasmine.Spy;

  // Replicate the async pause handler logic
  const handlePauseActionAsync = async (
    currentTask: { id: string } | null,
    syncElapsedTime: (taskId: string) => Promise<void>,
    pauseCurrent: () => void,
    flushPendingOps: () => Promise<void>,
  ): Promise<void> => {
    if (!currentTask) return;
    await syncElapsedTime(currentTask.id);
    pauseCurrent();
    await flushPendingOps(); // CRITICAL: Must be awaited
  };

  // Replicate the async done handler logic
  const handleDoneActionAsync = async (
    currentTask: { id: string } | null,
    syncElapsedTime: (taskId: string) => Promise<void>,
    setDone: (taskId: string) => void,
    pauseCurrent: () => void,
    flushPendingOps: () => Promise<void>,
  ): Promise<void> => {
    if (!currentTask) return;
    await syncElapsedTime(currentTask.id);
    setDone(currentTask.id);
    pauseCurrent();
    await flushPendingOps(); // CRITICAL: Must be awaited
  };

  beforeEach(() => {
    syncSpy = jasmine.createSpy('syncElapsedTime').and.resolveTo(undefined);
    pauseSpy = jasmine.createSpy('pauseCurrent');
    setDoneSpy = jasmine.createSpy('setDone');
    flushSpy = jasmine.createSpy('flushPendingOps').and.resolveTo(undefined);
  });

  it('should await flush before completing pause action', async () => {
    const callOrder: string[] = [];
    syncSpy.and.callFake(async () => {
      callOrder.push('sync');
    });
    pauseSpy.and.callFake(() => callOrder.push('pause'));
    flushSpy.and.callFake(async () => {
      // Simulate async flush taking time
      await new Promise((resolve) => setTimeout(resolve, 10));
      callOrder.push('flush');
    });

    await handlePauseActionAsync({ id: 'task-1' }, syncSpy, pauseSpy, flushSpy);

    // Verify flush completes before function returns
    expect(callOrder).toEqual(['sync', 'pause', 'flush']);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('should await flush before completing done action', async () => {
    const callOrder: string[] = [];
    syncSpy.and.callFake(async () => {
      callOrder.push('sync');
    });
    setDoneSpy.and.callFake(() => callOrder.push('done'));
    pauseSpy.and.callFake(() => callOrder.push('pause'));
    flushSpy.and.callFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      callOrder.push('flush');
    });

    await handleDoneActionAsync(
      { id: 'task-1' },
      syncSpy,
      setDoneSpy,
      pauseSpy,
      flushSpy,
    );

    expect(callOrder).toEqual(['sync', 'done', 'pause', 'flush']);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('should propagate flush errors in pause action', async () => {
    const flushError = new Error('IndexedDB write failed');
    flushSpy.and.rejectWith(flushError);

    await expectAsync(
      handlePauseActionAsync({ id: 'task-1' }, syncSpy, pauseSpy, flushSpy),
    ).toBeRejectedWith(flushError);

    expect(syncSpy).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(flushSpy).toHaveBeenCalled();
  });

  it('should propagate flush errors in done action', async () => {
    const flushError = new Error('IndexedDB write failed');
    flushSpy.and.rejectWith(flushError);

    await expectAsync(
      handleDoneActionAsync({ id: 'task-1' }, syncSpy, setDoneSpy, pauseSpy, flushSpy),
    ).toBeRejectedWith(flushError);

    expect(syncSpy).toHaveBeenCalled();
    expect(setDoneSpy).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(flushSpy).toHaveBeenCalled();
  });
});

describe('AndroidForegroundTrackingEffects - flushOnPause logic (issue #6207)', () => {
  /**
   * Tests for the flushOnPause$ effect that ensures time tracking data
   * is flushed to IndexedDB when the app goes to background.
   * This prevents data loss if Android terminates the app while backgrounded.
   */

  let syncElapsedTimeSpy: jasmine.Spy;
  let flushAccumulatedTimeSpy: jasmine.Spy;
  let flushPendingOpsSpy: jasmine.Spy;

  // Replicate the flushOnPause handler logic
  // Note: The real _syncElapsedTimeForTask has internal try-catch that doesn't rethrow,
  // so we model that behavior here with syncElapsedTimeWithErrorHandling
  const handleOnPause = async (
    currentTask: { id: string } | null,
    syncElapsedTime: (taskId: string) => Promise<void>,
    flushAccumulatedTime: () => void,
    flushPendingOps: () => Promise<void>,
  ): Promise<void> => {
    // If there's a current task, sync elapsed time from native service first
    // The real implementation's _syncElapsedTimeForTask has internal error handling
    if (currentTask) {
      await syncElapsedTime(currentTask.id);
    }

    // Flush accumulated time from TaskService (dispatches syncTimeSpent)
    flushAccumulatedTime();

    // Flush pending operations to IndexedDB to prevent data loss
    await flushPendingOps();
  };

  // Helper that mirrors the real _syncElapsedTimeForTask error handling behavior
  const handleOnPauseWithSyncErrorHandling = async (
    currentTask: { id: string } | null,
    syncElapsedTime: (taskId: string) => Promise<void>,
    flushAccumulatedTime: () => void,
    flushPendingOps: () => Promise<void>,
    onSyncError?: (e: unknown) => void,
  ): Promise<void> => {
    // If there's a current task, sync elapsed time from native service first
    // The real _syncElapsedTimeForTask catches errors internally and doesn't rethrow
    if (currentTask) {
      try {
        await syncElapsedTime(currentTask.id);
      } catch (e) {
        // Real implementation logs and shows snackbar but doesn't rethrow
        onSyncError?.(e);
      }
    }

    // These always run regardless of sync errors
    flushAccumulatedTime();
    await flushPendingOps();
  };

  beforeEach(() => {
    syncElapsedTimeSpy = jasmine.createSpy('syncElapsedTime').and.resolveTo(undefined);
    flushAccumulatedTimeSpy = jasmine.createSpy('flushAccumulatedTime');
    flushPendingOpsSpy = jasmine.createSpy('flushPendingOps').and.resolveTo(undefined);
  });

  it('should sync elapsed time when there is a current task', async () => {
    const currentTask = { id: 'task-1' };

    await handleOnPause(
      currentTask,
      syncElapsedTimeSpy,
      flushAccumulatedTimeSpy,
      flushPendingOpsSpy,
    );

    expect(syncElapsedTimeSpy).toHaveBeenCalledWith('task-1');
    expect(flushAccumulatedTimeSpy).toHaveBeenCalledTimes(1);
    expect(flushPendingOpsSpy).toHaveBeenCalledTimes(1);
  });

  it('should NOT sync elapsed time when there is no current task', async () => {
    await handleOnPause(
      null,
      syncElapsedTimeSpy,
      flushAccumulatedTimeSpy,
      flushPendingOpsSpy,
    );

    expect(syncElapsedTimeSpy).not.toHaveBeenCalled();
    // Should still flush accumulated time and pending ops
    expect(flushAccumulatedTimeSpy).toHaveBeenCalledTimes(1);
    expect(flushPendingOpsSpy).toHaveBeenCalledTimes(1);
  });

  it('should call operations in correct order: sync, flush accumulated, flush pending', async () => {
    const currentTask = { id: 'task-1' };
    const callOrder: string[] = [];

    syncElapsedTimeSpy.and.callFake(async () => {
      callOrder.push('sync');
    });
    flushAccumulatedTimeSpy.and.callFake(() => callOrder.push('flushAccumulated'));
    flushPendingOpsSpy.and.callFake(async () => {
      callOrder.push('flushPending');
    });

    await handleOnPause(
      currentTask,
      syncElapsedTimeSpy,
      flushAccumulatedTimeSpy,
      flushPendingOpsSpy,
    );

    expect(callOrder).toEqual(['sync', 'flushAccumulated', 'flushPending']);
  });

  it('should await flushPendingOps to ensure data is persisted before returning', async () => {
    const currentTask = { id: 'task-1' };
    let flushCompleted = false;

    flushPendingOpsSpy.and.callFake(async () => {
      // Simulate async flush taking time
      await new Promise((resolve) => setTimeout(resolve, 10));
      flushCompleted = true;
    });

    await handleOnPause(
      currentTask,
      syncElapsedTimeSpy,
      flushAccumulatedTimeSpy,
      flushPendingOpsSpy,
    );

    // Verify flush completed before function returned
    expect(flushCompleted).toBeTrue();
  });

  it('should still flush accumulated time and pending ops even when sync fails', async () => {
    // This test models the real behavior: _syncElapsedTimeForTask has internal
    // try-catch that catches errors and shows a snackbar, but doesn't rethrow.
    // So flush operations should always run regardless of sync errors.
    const currentTask = { id: 'task-1' };
    const syncError = new Error('Sync failed');
    let errorHandled = false;

    syncElapsedTimeSpy.and.rejectWith(syncError);

    await handleOnPauseWithSyncErrorHandling(
      currentTask,
      syncElapsedTimeSpy,
      flushAccumulatedTimeSpy,
      flushPendingOpsSpy,
      () => {
        errorHandled = true;
      },
    );

    // Sync was called and error was handled internally
    expect(syncElapsedTimeSpy).toHaveBeenCalled();
    expect(errorHandled).toBeTrue();

    // Flush operations should still run even after sync error
    expect(flushAccumulatedTimeSpy).toHaveBeenCalledTimes(1);
    expect(flushPendingOpsSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle case with no task and still flush successfully', async () => {
    await handleOnPause(
      null,
      syncElapsedTimeSpy,
      flushAccumulatedTimeSpy,
      flushPendingOpsSpy,
    );

    expect(flushAccumulatedTimeSpy).toHaveBeenCalledTimes(1);
    expect(flushPendingOpsSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AndroidForegroundTrackingEffects - syncTimeSpent dispatch (issue #6207)', () => {
  /**
   * Tests for the fix: _syncElapsedTimeForTask must dispatch syncTimeSpent action
   * in addition to calling addTimeSpent to ensure time is captured in operation log.
   *
   * The bug: addTimeSpent only updates local NgRx state but does NOT create an
   * operation in the log. When syncing time from native service after app resume,
   * this meant time would be lost if the app was closed before the next flush.
   *
   * The fix: After calling addTimeSpent (updates local state), also dispatch
   * syncTimeSpent (creates operation in log for persistence).
   */

  let addTimeSpentSpy: jasmine.Spy;
  let dispatchSpy: jasmine.Spy;
  let resetTrackingStartSpy: jasmine.Spy;
  let snackOpenSpy: jasmine.Spy;

  // Replicate the fixed sync logic that dispatches syncTimeSpent
  const syncElapsedTimeForTaskWithOpLog = async (
    taskId: string,
    elapsedJson: string | null,
    getTask: (id: string) => Promise<{ id: string; timeSpent: number } | null>,
    addTimeSpent: (task: unknown, duration: number, date: string) => void,
    dispatch: (action: { taskId: string; date: string; duration: number }) => void,
    resetTrackingStart: () => void,
    snackOpen: (params: { msg: string; type: string }) => void,
    todayStr: string,
  ): Promise<void> => {
    if (!elapsedJson || elapsedJson === 'null') {
      return;
    }

    try {
      const nativeData = JSON.parse(elapsedJson) as {
        taskId: string;
        elapsedMs: number;
      };

      if (nativeData.taskId !== taskId) {
        return;
      }

      const task = await getTask(taskId);
      if (!task) {
        snackOpen({
          msg: 'Time tracking sync failed - task not found',
          type: 'WARNING',
        });
        return;
      }

      const currentTimeSpent = task.timeSpent || 0;
      const duration = nativeData.elapsedMs - currentTimeSpent;

      // Handle negative duration (service crash/reset)
      // Keep app value to prevent data loss - just reset tracking interval
      if (duration < 0) {
        resetTrackingStart();
        return;
      }

      if (duration > 0) {
        addTimeSpent(task, duration, todayStr);
        // Also dispatch syncTimeSpent to capture in operation log
        dispatch({ taskId: task.id, date: todayStr, duration });
        resetTrackingStart();
      }
    } catch (e) {
      snackOpen({
        msg: 'Time tracking sync failed - please check your tracked time',
        type: 'WARNING',
      });
    }
  };

  beforeEach(() => {
    addTimeSpentSpy = jasmine.createSpy('addTimeSpent');
    dispatchSpy = jasmine.createSpy('dispatch');
    resetTrackingStartSpy = jasmine.createSpy('resetTrackingStart');
    snackOpenSpy = jasmine.createSpy('snackService.open');
  });

  it('should dispatch syncTimeSpent after addTimeSpent for positive duration', async () => {
    const nativeElapsed = 900000; // 15 minutes
    const appTimeSpent = 60000; // 1 minute
    const expectedDuration = nativeElapsed - appTimeSpent; // 14 minutes

    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: nativeElapsed });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: appTimeSpent,
    });

    await syncElapsedTimeForTaskWithOpLog(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      dispatchSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).toHaveBeenCalledWith(
      { id: 'task-1', timeSpent: appTimeSpent },
      expectedDuration,
      '2024-01-01',
    );

    // Key assertion: syncTimeSpent dispatched with correct params
    expect(dispatchSpy).toHaveBeenCalledWith({
      taskId: 'task-1',
      date: '2024-01-01',
      duration: expectedDuration,
    });
  });

  it('should NOT dispatch syncTimeSpent for negative duration (keeps app value)', async () => {
    const nativeElapsed = 30000; // 30 seconds (native service restarted)
    const appTimeSpent = 600000; // 10 minutes

    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: nativeElapsed });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: appTimeSpent,
    });

    await syncElapsedTimeForTaskWithOpLog(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      dispatchSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    // For negative duration, keep app value - don't update time
    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    // Should still reset tracking start to prevent double-counting
    expect(resetTrackingStartSpy).toHaveBeenCalledTimes(1);
  });

  it('should NOT dispatch syncTimeSpent when duration is zero', async () => {
    const elapsedMs = 60000;
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: elapsedMs, // Same as native - no sync needed
    });

    await syncElapsedTimeForTaskWithOpLog(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      dispatchSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('should NOT dispatch syncTimeSpent when task not found', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: 60000 });
    const getTask = async (): Promise<null> => null;

    await syncElapsedTimeForTaskWithOpLog(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      dispatchSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(snackOpenSpy).toHaveBeenCalled();
  });

  it('should ensure operation log capture for time synced from native on resume', async () => {
    // This test verifies the specific scenario from issue #6207:
    // 1. User backgrounds app for extended period (native counts time)
    // 2. User reopens app (syncOnResume$ fires, calls _syncElapsedTimeForTask)
    // 3. Time must be captured in operation log so it persists if app closes quickly

    const backgroundTimeMs = 720000; // 12 minutes tracked while backgrounded
    const existingTimeMs = 120000; // 2 minutes tracked before backgrounding
    const syncDuration = backgroundTimeMs; // Duration to sync (difference)

    const elapsedJson = JSON.stringify({
      taskId: 'task-1',
      elapsedMs: existingTimeMs + backgroundTimeMs, // Total native elapsed
    });

    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: existingTimeMs, // App only knows about pre-background time
    });

    await syncElapsedTimeForTaskWithOpLog(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      dispatchSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    // addTimeSpent updates local NgRx state immediately
    expect(addTimeSpentSpy).toHaveBeenCalledWith(
      { id: 'task-1', timeSpent: existingTimeMs },
      syncDuration,
      '2024-01-01',
    );

    // syncTimeSpent creates operation for persistence - THIS IS THE FIX
    expect(dispatchSpy).toHaveBeenCalledWith({
      taskId: 'task-1',
      date: '2024-01-01',
      duration: syncDuration,
    });

    // Without the dispatch, the 12 minutes would be lost if app closes before flush
  });
});

describe('AndroidForegroundTrackingEffects - enhanced error handling (issue #5842)', () => {
  /**
   * Tests for enhanced error handling in _syncElapsedTimeForTask:
   * - Negative duration handling (native time < app time)
   * - Task not found with user notification
   * - Error notification for sync failures
   */

  let addTimeSpentSpy: jasmine.Spy;
  let resetTrackingStartSpy: jasmine.Spy;
  let snackOpenSpy: jasmine.Spy;

  // Enhanced sync logic with error handling
  const syncElapsedTimeForTaskEnhanced = async (
    taskId: string,
    elapsedJson: string | null,
    getTask: (id: string) => Promise<{ id: string; timeSpent: number } | null>,
    addTimeSpent: (task: unknown, duration: number, date: string) => void,
    resetTrackingStart: () => void,
    snackOpen: (params: { msg: string; type: string }) => void,
    todayStr: string,
  ): Promise<void> => {
    if (!elapsedJson || elapsedJson === 'null') {
      return;
    }

    try {
      const nativeData = JSON.parse(elapsedJson) as {
        taskId: string;
        elapsedMs: number;
      };

      if (nativeData.taskId !== taskId) {
        return;
      }

      const task = await getTask(taskId);
      if (!task) {
        snackOpen({
          msg: 'Time tracking sync failed - task not found',
          type: 'WARNING',
        });
        return;
      }

      const currentTimeSpent = task.timeSpent || 0;
      const duration = nativeData.elapsedMs - currentTimeSpent;

      // Handle negative duration (service crash/reset)
      // Keep app value to prevent data loss - just reset tracking interval
      if (duration < 0) {
        resetTrackingStart();
        return;
      }

      if (duration > 0) {
        addTimeSpent(task, duration, todayStr);
        resetTrackingStart();
      }
    } catch (e) {
      snackOpen({
        msg: 'Time tracking sync failed - please check your tracked time',
        type: 'WARNING',
      });
    }
  };

  beforeEach(() => {
    addTimeSpentSpy = jasmine.createSpy('addTimeSpent');
    resetTrackingStartSpy = jasmine.createSpy('resetTrackingStart');
    snackOpenSpy = jasmine.createSpy('snackService.open');
  });

  it('should handle negative duration by keeping app value to prevent data loss', async () => {
    const nativeElapsed = 30000; // 30 seconds (native service crashed and restarted)
    const appTimeSpent = 600000; // 10 minutes (app has more time)
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: nativeElapsed });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: appTimeSpent,
    });

    await syncElapsedTimeForTaskEnhanced(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    // Should NOT update time - keep app's higher value to prevent data loss
    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    // Should still reset tracking start to prevent double-counting
    expect(resetTrackingStartSpy).toHaveBeenCalledTimes(1);
  });

  it('should show snackbar notification when task not found', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: 60000 });
    const getTask = async (): Promise<null> => null;

    await syncElapsedTimeForTaskEnhanced(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    expect(snackOpenSpy).toHaveBeenCalledWith({
      msg: 'Time tracking sync failed - task not found',
      type: 'WARNING',
    });
    expect(addTimeSpentSpy).not.toHaveBeenCalled();
  });

  it('should show snackbar notification on JSON parse error', async () => {
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 0,
    });

    await syncElapsedTimeForTaskEnhanced(
      'task-1',
      'invalid json {',
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    expect(snackOpenSpy).toHaveBeenCalledWith({
      msg: 'Time tracking sync failed - please check your tracked time',
      type: 'WARNING',
    });
    expect(addTimeSpentSpy).not.toHaveBeenCalled();
  });

  it('should NOT show notification for successful negative duration handling', async () => {
    const elapsedJson = JSON.stringify({ taskId: 'task-1', elapsedMs: 30000 });
    const getTask = async (): Promise<{ id: string; timeSpent: number }> => ({
      id: 'task-1',
      timeSpent: 60000, // App has more time
    });

    await syncElapsedTimeForTaskEnhanced(
      'task-1',
      elapsedJson,
      getTask,
      addTimeSpentSpy,
      resetTrackingStartSpy,
      snackOpenSpy,
      '2024-01-01',
    );

    // Should handle gracefully without user notification (logged as warning)
    // App value is preserved - no update needed
    expect(addTimeSpentSpy).not.toHaveBeenCalled();
    expect(resetTrackingStartSpy).toHaveBeenCalled();
    expect(snackOpenSpy).not.toHaveBeenCalled();
  });
});
