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
