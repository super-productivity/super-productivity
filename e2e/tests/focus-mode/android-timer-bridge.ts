/**
 * Native boundary for the Android timer regressions. The application, effects,
 * reducers and IndexedDB are real. These two services survive a page reload via
 * sessionStorage, modelling WebView recreation, NOT Android process death.
 * Payloads match JavaScriptInterface.get{FocusMode,Tracking}Elapsed().
 */
export const installAndroidTimerBridge = (): void => {
  if (window !== window.top) return;

  type Focus = {
    durationMs: number;
    remainingMs: number;
    isBreak: boolean;
    isPaused: boolean;
    anchor: number;
  };
  type Tracking = { taskId: string; elapsedMs: number; anchor: number };
  type FocusTask = Tracking & { active: boolean };
  const readFocus = (): Focus | null =>
    JSON.parse(sessionStorage.getItem('test-native-focus') || 'null');
  const writeFocus = (value: Focus | null): void =>
    sessionStorage.setItem('test-native-focus', JSON.stringify(value));
  const readTracking = (): Tracking | null =>
    JSON.parse(sessionStorage.getItem('test-native-tracking') || 'null');
  const writeTracking = (value: Tracking | null): void =>
    sessionStorage.setItem('test-native-tracking', JSON.stringify(value));
  const readFocusTask = (): FocusTask | null =>
    JSON.parse(sessionStorage.getItem('test-native-focus-task') || 'null');
  const writeFocusTask = (value: FocusTask | null): void =>
    sessionStorage.setItem('test-native-focus-task', JSON.stringify(value));
  const taskElapsed = (task: FocusTask): number =>
    task.elapsedMs +
    (task.active && !readFocus()?.isPaused ? Date.now() - task.anchor : 0);
  const checkpointTask = (): void => {
    const task = readFocusTask();
    if (task)
      writeFocusTask({ ...task, elapsedMs: taskElapsed(task), anchor: Date.now() });
  };
  // Native service commands run in order on Android's main thread. A STOP
  // followed by START must finish running, even when both arrive in one turn.
  const enqueue = (command: () => void): void => {
    setTimeout(command, 0);
  };

  const bridge = {
    showToast: (): void => {},
    // The app replaces these callbacks when initializing SUPAndroid.
    saveToDbCallback: (_requestId: string): void => {},
    loadFromDbCallback: (
      _requestId: string,
      _key: string,
      _value: string | null,
    ): void => {},
    saveToDb: (requestId: string, key: string, value: string): void => {
      localStorage.setItem(`test-native-db:${key}`, value);
      setTimeout(() => bridge.saveToDbCallback(requestId), 0);
    },
    loadFromDb: (requestId: string, key: string): void => {
      setTimeout(
        () =>
          bridge.loadFromDbCallback(
            requestId,
            key,
            localStorage.getItem(`test-native-db:${key}`),
          ),
        0,
      );
    },
    startTrackingService: (taskId: string, _title: string, elapsedMs: number): void =>
      enqueue(() => writeTracking({ taskId, elapsedMs, anchor: Date.now() })),
    stopTrackingService: (): void => enqueue(() => writeTracking(null)),
    updateTrackingService: (elapsedMs: number): void => {
      enqueue(() => {
        const tracking = readTracking();
        if (tracking) writeTracking({ ...tracking, elapsedMs, anchor: Date.now() });
      });
    },
    getTrackingElapsed: (): string => {
      const tracking = readTracking();
      return JSON.stringify(
        tracking && {
          taskId: tracking.taskId,
          elapsedMs: tracking.elapsedMs + Date.now() - tracking.anchor,
        },
      );
    },
    startFocusModeService: (
      _title: string,
      durationMs: number,
      remainingMs: number,
      isBreak: boolean,
      isPaused: boolean,
    ): void =>
      enqueue(() => {
        checkpointTask();
        writeFocus({ durationMs, remainingMs, isBreak, isPaused, anchor: Date.now() });
      }),
    updateFocusModeService: (
      _title: string,
      remainingMs: number,
      isPaused: boolean,
      isBreak: boolean,
    ): void => {
      enqueue(() => {
        checkpointTask();
        const focus = readFocus();
        if (focus) {
          writeFocus({ ...focus, remainingMs, isPaused, isBreak, anchor: Date.now() });
        }
      });
    },
    stopFocusModeService: (): void => {
      if (readFocus()) {
        const previous = Number(sessionStorage.getItem('test-stopped-live-focus'));
        sessionStorage.setItem('test-stopped-live-focus', String(previous + 1));
      }
      // Android queues the stop on its main thread. Do not assume a synchronous
      // stop or assert which side of hydration wins that race.
      enqueue(() => {
        writeFocus(null);
        writeFocusTask(null);
      });
    },
    updateFocusTask: (
      taskId: string | null,
      timeSpentMs: number,
      isTracking: boolean,
    ): void => {
      enqueue(() => {
        const previous = readFocusTask();
        if (taskId) {
          writeFocusTask({
            taskId,
            elapsedMs: timeSpentMs,
            anchor: Date.now(),
            active: isTracking,
          });
        } else if (previous) {
          writeFocusTask({
            ...previous,
            elapsedMs: taskElapsed(previous),
            anchor: Date.now(),
            active: false,
          });
        }
      });
    },
    adjustFocusTaskTime: (taskId: string, timeSpentDeltaMs: number): void => {
      enqueue(() => {
        const task = readFocusTask();
        if (task?.taskId === taskId) {
          writeFocusTask({
            ...task,
            elapsedMs: Math.max(0, task.elapsedMs + timeSpentDeltaMs),
          });
        }
      });
    },
    getFocusModeElapsed: (): string => {
      const focus = readFocus();
      if (!focus) return 'null';
      const delta = focus.isPaused ? 0 : Date.now() - focus.anchor;
      const task = readFocusTask();
      return JSON.stringify({
        durationMs: focus.durationMs,
        remainingMs:
          focus.durationMs > 0
            ? Math.max(0, focus.remainingMs - delta)
            : focus.remainingMs + delta,
        isBreak: focus.isBreak,
        isPaused: focus.isPaused,
        ...(task
          ? {
              taskId: task.taskId,
              taskTimeSpentMs: taskElapsed(task),
              isTaskTracking: task.active && !focus.isPaused,
            }
          : {}),
      });
    },
  };
  Object.assign(window, { SUPAndroid: bridge });
};
