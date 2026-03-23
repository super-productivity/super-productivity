import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { nanoid } from 'nanoid';
import { BehaviorSubject, merge, Observable, ReplaySubject, Subject } from 'rxjs';
import { mapTo } from 'rxjs/operators';
import { DroidLog } from '../../core/log';

export interface AndroidInterface {
  getVersion?(): string;

  showToast(s: string): void;

  // save
  saveToDbWrapped(key: string, value: string): Promise<void>;

  saveToDb(rId: string, key: string, value: string): void;

  saveToDbCallback(rId: string): void;

  // load
  loadFromDbWrapped(key: string): Promise<string | null>;

  loadFromDb(rId: string, key: string): void;

  loadFromDbCallback(rId: string, data: string): void;

  // remove
  removeFromDbWrapped(key: string): Promise<void>;

  removeFromDb(rId: string, key: string): void;

  removeFromDbCallback(rId: string): void;

  // clear db
  clearDbWrapped(): Promise<void>;

  clearDb(rId: string): void; // @deprecated
  clearDbCallback(rId: string): void;

  triggerGetShareData?(): void;
  getPendingShareData?(): string | null;

  // Foreground service methods for background time tracking
  startTrackingService?(taskId: string, taskTitle: string, timeSpentMs: number): void;
  stopTrackingService?(): void;
  updateTrackingService?(timeSpentMs: number): void;
  getTrackingElapsed?(): string;

  // Foreground service methods for focus mode timer
  startFocusModeService?(
    title: string,
    durationMs: number,
    remainingMs: number,
    isBreak: boolean,
    isPaused: boolean,
    taskTitle: string | null,
  ): void;
  stopFocusModeService?(): void;
  updateFocusModeService?(
    title: string,
    remainingMs: number,
    isPaused: boolean,
    isBreak: boolean,
    taskTitle: string | null,
  ): void;

  // Native reminder scheduling (snooze handled entirely in background)
  scheduleNativeReminder?(
    notificationId: number,
    reminderId: string,
    relatedId: string,
    title: string,
    reminderType: string,
    triggerAtMs: number,
    useAlarmStyle: boolean,
    isOngoing: boolean,
  ): void;
  cancelNativeReminder?(notificationId: number): void;

  // Reminder tap queue - get task ID from notification tap (cold start)
  getReminderTapQueue?(): string | null;

  // Reminder done queue - get task IDs marked done from notifications
  getReminderDoneQueue?(): string | null;

  // Widget task queue - get queued tasks from home screen widget
  getWidgetTaskQueue?(): string | null;

  // Startup overlay
  getStartupOverlayPartialText?(): string | null;
  hideStartupOverlay?(): void;
  dismissStartupOverlay?(): void;

  // added here only
  onResume$: Subject<void>;
  onPause$: Subject<void>;
  isInBackground$: Observable<boolean>;
  isKeyboardShown$: Subject<boolean>;

  onShareWithAttachment$: Subject<{
    title: string;
    type: 'FILE' | 'LINK' | 'IMG' | 'COMMAND' | 'NOTE';
    path: string;
  }>;

  // Notification action callbacks
  onPauseTracking$: Subject<void>;
  onMarkTaskDone$: Subject<void>;

  // Focus mode notification action callbacks
  onFocusPause$: Subject<void>;
  onFocusResume$: Subject<void>;
  onFocusSkip$: Subject<void>;
  onFocusComplete$: Subject<void>;

  // Focus mode timer completion (native service detected timer reached 0)
  onFocusModeTimerComplete$: Subject<boolean>; // boolean indicates isBreak

  // Reminder notification action callbacks
  onReminderTap$: ReplaySubject<string>; // emits taskId
  onReminderDone$: ReplaySubject<string>; // emits taskId
  onReminderSnooze$: ReplaySubject<{ taskId: string; newRemindAt: number }>; // emits snooze events
  getReminderSnoozeQueue?(): string | null;

  // Background sync credential bridge (for WorkManager-based reminder cancellation)
  setSuperSyncCredentials?(baseUrl: string, accessToken: string): void;
  clearSuperSyncCredentials?(): void;
}

// setInterval(() => {
//   androidInterface.updatePermanentNotification?.(new Date().toString(), '', -1);
// }, 7000);

export const androidInterface: AndroidInterface = (window as any).SUPAndroid;

if (IS_ANDROID_WEB_VIEW) {
  if (!androidInterface) {
    throw new Error('Cannot initialize androidInterface');
  }

  androidInterface.onResume$ = new Subject();
  androidInterface.onPause$ = new Subject();
  androidInterface.onPauseTracking$ = new Subject();
  androidInterface.onMarkTaskDone$ = new Subject();
  androidInterface.onFocusPause$ = new Subject();
  androidInterface.onFocusResume$ = new Subject();
  androidInterface.onFocusSkip$ = new Subject();
  androidInterface.onFocusComplete$ = new Subject();
  androidInterface.onFocusModeTimerComplete$ = new Subject();
  androidInterface.onReminderTap$ = new ReplaySubject(5);
  androidInterface.onReminderDone$ = new ReplaySubject(20);
  androidInterface.onReminderSnooze$ = new ReplaySubject(20);
  androidInterface.onShareWithAttachment$ = new ReplaySubject(1);
  androidInterface.isKeyboardShown$ = new BehaviorSubject(false);

  androidInterface.isInBackground$ = merge(
    androidInterface.onResume$.pipe(mapTo(false)),
    androidInterface.onPause$.pipe(mapTo(true)),
  );

  const requestMap: {
    [key: string]: {
      resolve: (returnVal?: any) => void;
      reject: (error?: any) => void;
    };
  } = {};

  const getRequestMapPromise = (rId: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      requestMap[rId] = { resolve, reject };
    });
  };

  androidInterface.saveToDbCallback = (rId: string) => {
    requestMap[rId].resolve();
    delete requestMap[rId];
  };

  androidInterface.saveToDbWrapped = (key: string, value: string): Promise<void> => {
    const rId = nanoid();
    androidInterface.saveToDb(rId, key, value);
    return getRequestMapPromise(rId);
  };

  androidInterface.loadFromDbCallback = (rId: string, k: string, result?: string) => {
    requestMap[rId].resolve(result || null);
    delete requestMap[rId];
  };
  androidInterface.loadFromDbWrapped = (key: string): Promise<string | null> => {
    const rId = nanoid();
    androidInterface.loadFromDb(rId, key);
    return getRequestMapPromise(rId);
  };

  androidInterface.removeFromDbWrapped = (key: string): Promise<void> => {
    const rId = nanoid();
    androidInterface.removeFromDb(rId, key);
    return getRequestMapPromise(rId);
  };
  androidInterface.removeFromDbCallback = (rId: string) => {
    requestMap[rId].resolve();
    delete requestMap[rId];
  };

  androidInterface.clearDbWrapped = (): Promise<void> => {
    const rId = nanoid();
    androidInterface.clearDb?.(rId);
    return getRequestMapPromise(rId);
  };
  androidInterface.clearDbCallback = (rId: string) => {
    requestMap[rId].resolve();
    delete requestMap[rId];
  };

  DroidLog.log('Android Web View interfaces initialized', androidInterface);

  // Pull-based: retrieve share data persisted in SharedPreferences (survives process death)
  try {
    const pendingShare = androidInterface.getPendingShareData?.();
    if (pendingShare) {
      const parsed = JSON.parse(pendingShare);
      DroidLog.log('Pulled pending share data from SharedPreferences', parsed);
      androidInterface.onShareWithAttachment$.next(parsed);
    }
  } catch (e) {
    DroidLog.err('Failed to parse pending share data', e);
  }

  // Pull-based: retrieve queued tap task ID from notification tap (cold start)
  try {
    const tapTaskId = androidInterface.getReminderTapQueue?.();
    if (tapTaskId) {
      DroidLog.log('Pulled reminder tap queue from SharedPreferences', tapTaskId);
      androidInterface.onReminderTap$.next(tapTaskId);
    }
  } catch (e) {
    DroidLog.err('Failed to parse reminder tap queue', e);
  }

  // Pull-based: retrieve queued "Done" task IDs from notification actions
  try {
    const doneQueue = androidInterface.getReminderDoneQueue?.();
    if (doneQueue) {
      const taskIds: string[] = JSON.parse(doneQueue);
      DroidLog.log('Pulled reminder done queue from SharedPreferences', taskIds);
      for (const id of taskIds) {
        androidInterface.onReminderDone$.next(id);
      }
    }
  } catch (e) {
    DroidLog.err('Failed to parse reminder done queue', e);
  }

  // Pull-based: retrieve queued snooze events from notification actions
  try {
    const snoozeQueue = androidInterface.getReminderSnoozeQueue?.();
    if (snoozeQueue) {
      const events: { taskId: string; newRemindAt: number }[] = JSON.parse(snoozeQueue);
      DroidLog.log('Pulled reminder snooze queue from SharedPreferences', events);
      for (const event of events) {
        androidInterface.onReminderSnooze$.next(event);
      }
    }
  } catch (e) {
    DroidLog.err('Failed to parse reminder snooze queue', e);
  }

  // Push-based: sets isFrontendReady=true on native side for warm-start shares
  androidInterface.triggerGetShareData?.();
}
