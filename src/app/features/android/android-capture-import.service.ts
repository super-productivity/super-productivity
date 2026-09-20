import { inject, Injectable, InjectionToken } from '@angular/core';
import { Store } from '@ngrx/store';
import { filter, firstValueFrom } from 'rxjs';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { TaskService } from '../tasks/task.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from './android-interface';

/** One entry of the native `CaptureInbox` (see CaptureInbox.kt). */
export interface AndroidCapture {
  id: string;
  title: string;
  createdAt: number;
}

/** The native bridge methods backed by CaptureInbox.kt. */
export interface AndroidCaptureInbox {
  getPendingCaptures(): string | null;
  acknowledgeCapture(id: string): boolean;
}

export const ANDROID_CAPTURE_INBOX = new InjectionToken<AndroidCaptureInbox | null>(
  'ANDROID_CAPTURE_INBOX',
  {
    providedIn: 'root',
    factory: () =>
      IS_ANDROID_WEB_VIEW && androidInterface.getPendingCaptures
        ? (androidInterface as AndroidCaptureInbox)
        : null,
  },
);

export const ANDROID_CAPTURE_RECEIPTS_KEY = 'sp-android-capture-receipts';

// Fixed messages that never contain user content, so they are safe to log.
const ERR = {
  READ: 'Could not read capture inbox',
  INVALID: 'Invalid capture inbox',
  PERSIST: 'Task persistence failed',
  ACK: 'Could not acknowledge capture',
} as const;
const KNOWN_ERRORS: ReadonlySet<string> = new Set(Object.values(ERR));

/**
 * Log-safe reason for an import failure: one of the importer's own messages,
 * otherwise only the error name (e.g. a JSON.parse message can quote a title).
 */
export const getCaptureImportErrorReason = (e: unknown): string =>
  e instanceof Error ? (KNOWN_ERRORS.has(e.message) ? e.message : e.name) : 'unknown';

const parseCaptures = (json: string): AndroidCapture[] => {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error(ERR.INVALID);
  }
  return parsed.filter(
    (c): c is AndroidCapture =>
      typeof c?.id === 'string' && typeof c?.title === 'string' && !!c.title.trim(),
  );
};

/**
 * Imports tasks captured natively (startup quick-add overlay) from the durable
 * native inbox. An entry is acknowledged (deleted) only after its task is
 * persisted; the capture id is the task id, so redelivery after a crash is
 * recognised instead of creating a duplicate. Same rules as the iOS share
 * importer (#10033); both are meant to merge into one importer later.
 */
@Injectable({ providedIn: 'root' })
export class AndroidCaptureImportService {
  private _inbox = inject(ANDROID_CAPTURE_INBOX);
  private _store = inject(Store);
  private _tasks = this._store.selectSignal(selectTaskEntities);
  private _taskService = inject(TaskService);
  private _dataInit = inject(DataInitStateService);
  private _syncTrigger = inject(SyncTriggerService);
  private _hydration = inject(HydrationStateService);
  private _flush = inject(OperationWriteFlushService);
  private _capture = inject(OperationCaptureService);

  /**
   * Must be called serially (startup and resume).
   * @returns the number of tasks created in this run
   */
  async importPending(): Promise<number> {
    if (!this._inbox) {
      return 0;
    }
    await firstValueFrom(this._dataInit.isAllDataLoadedInitially$);
    await firstValueFrom(this._syncTrigger.afterInitialSyncDoneStrict$);
    const json = this._inbox.getPendingCaptures();
    if (json === null) {
      throw new Error(ERR.READ);
    }
    const captures = parseCaptures(json);

    // Receipts bridge a failed native acknowledgement even if the user deletes
    // the task in between. IDs only; pruned once the native entry is gone.
    const receipts = new Set<string>(
      JSON.parse(localStorage.getItem(ANDROID_CAPTURE_RECEIPTS_KEY) || '[]'),
    );
    const pendingIds = new Set(captures.map((c) => c.id));
    for (const id of receipts) {
      if (!pendingIds.has(id)) {
        receipts.delete(id);
      }
    }
    const saveReceipts = (): void =>
      localStorage.setItem(ANDROID_CAPTURE_RECEIPTS_KEY, JSON.stringify([...receipts]));
    saveReceipts();

    let created = 0;
    for (const capture of captures) {
      if (!receipts.has(capture.id)) {
        // A resume can overlap remote replay. Wait without a fail-open timeout,
        // and recheck synchronously before dispatch.
        do {
          await firstValueFrom(
            this._hydration.isInSyncWindow$.pipe(filter((active) => !active)),
          );
        } while (this._hydration.isInSyncWindow());
        if (!this._tasks()[capture.id]) {
          // Same behaviour as typing into the in-app add bar: active work
          // context and short syntax. Only the id is fixed.
          this._taskService.add(capture.title, false, { id: capture.id });
          created++;
        }
        // Never acknowledge a task that exists only in memory.
        await this._flush.flushPendingWrites();
        if (this._capture.hasUnrecoveredPersistFailure()) {
          throw new Error(ERR.PERSIST);
        }
        receipts.add(capture.id);
        saveReceipts();
      }
      if (!this._inbox.acknowledgeCapture(capture.id)) {
        throw new Error(ERR.ACK);
      }
      receipts.delete(capture.id);
      saveReceipts();
    }
    return created;
  }
}
