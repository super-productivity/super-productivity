import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { filter, firstValueFrom } from 'rxjs';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { selectTaskEntities } from '../store/task.selectors';

/** A platform's durable native inbox (Android CaptureInbox.kt, iOS ShareInbox.swift). */
export interface NativeCaptureSource<T extends { id: string }> {
  /** localStorage key for this source's id-only receipts. Never rename: installs keep them. */
  receiptsKey: string;
  /** Non-destructive read, oldest first. */
  getPending(): Promise<T[]>;
  /** Invalid entries are skipped and kept on disk so they cannot block later ones. */
  isValid(capture: T): boolean;
  /** Dispatches exactly one addTask whose task id is `capture.id`. */
  createTask(capture: T): void;
  /** Deletes one entry; rejects if it could not be deleted. */
  acknowledge(id: string): Promise<void>;
}

export interface NativeCaptureImportResult {
  created: number;
  invalid: number;
}

// Fixed messages that never contain user content, so they are safe to log.
export const CAPTURE_IMPORT_ERR = {
  READ: 'Could not read capture inbox',
  INVALID_INBOX: 'Invalid capture inbox',
  INVALID_ENTRY: 'Invalid capture entry',
  PERSIST: 'Task persistence failed',
  ACK: 'Could not acknowledge capture',
} as const;
const KNOWN_ERRORS: ReadonlySet<string> = new Set(Object.values(CAPTURE_IMPORT_ERR));

/**
 * Log-safe reason for an import failure: one of the importer's own messages,
 * otherwise only the error name (e.g. a JSON.parse message can quote a title).
 */
export const getCaptureImportErrorReason = (e: unknown): string =>
  e instanceof Error ? (KNOWN_ERRORS.has(e.message) ? e.message : e.name) : 'unknown';

/**
 * Turns natively captured entries into tasks exactly once. An entry is
 * acknowledged (deleted natively) only after its task is persisted; the capture
 * id is the task id, so redelivery after a crash is recognised instead of
 * creating a duplicate. Short-lived id-only receipts bridge a failed
 * acknowledgement even if the user deletes the task in between.
 */
@Injectable({ providedIn: 'root' })
export class NativeCaptureImporter {
  private _store = inject(Store);
  private _tasks = this._store.selectSignal(selectTaskEntities);
  private _dataInit = inject(DataInitStateService);
  private _syncTrigger = inject(SyncTriggerService);
  private _hydration = inject(HydrationStateService);
  private _flush = inject(OperationWriteFlushService);
  private _capture = inject(OperationCaptureService);

  /** Must be called serially per source (startup and resume). */
  async importPending<T extends { id: string }>(
    source: NativeCaptureSource<T>,
  ): Promise<NativeCaptureImportResult> {
    await firstValueFrom(this._dataInit.isAllDataLoadedInitially$);
    await firstValueFrom(this._syncTrigger.afterInitialSyncDoneStrict$);
    const captures = await source.getPending();
    const receipts = this._loadPrunedReceipts(source.receiptsKey, captures);
    const saveReceipts = (): void =>
      localStorage.setItem(source.receiptsKey, JSON.stringify([...receipts]));
    saveReceipts();

    const result: NativeCaptureImportResult = { created: 0, invalid: 0 };
    for (const capture of captures) {
      if (!source.isValid(capture)) {
        result.invalid++;
        continue;
      }
      if (!receipts.has(capture.id)) {
        if (await this._createAndPersist(source, capture)) {
          result.created++;
        }
        receipts.add(capture.id);
        saveReceipts();
      }
      await source.acknowledge(capture.id);
      receipts.delete(capture.id);
      saveReceipts();
    }
    return result;
  }

  /** @returns true if a task was created, false if it already existed */
  private async _createAndPersist<T extends { id: string }>(
    source: NativeCaptureSource<T>,
    capture: T,
  ): Promise<boolean> {
    // A resume can overlap remote replay. Wait without a fail-open timeout,
    // and recheck synchronously before dispatch.
    do {
      await firstValueFrom(
        this._hydration.isInSyncWindow$.pipe(filter((active) => !active)),
      );
    } while (this._hydration.isInSyncWindow());
    const isNew = !this._tasks()[capture.id];
    if (isNew) {
      source.createTask(capture);
    }
    // Flush drains writes even on failure; the sticky divergence marker is
    // essential here. Never acknowledge a task that exists only in memory.
    await this._flush.flushPendingWrites();
    if (this._capture.hasUnrecoveredPersistFailure()) {
      throw new Error(CAPTURE_IMPORT_ERR.PERSIST);
    }
    return isNew;
  }

  private _loadPrunedReceipts(key: string, captures: { id: string }[]): Set<string> {
    const receipts = new Set<string>(JSON.parse(localStorage.getItem(key) || '[]'));
    const pendingIds = new Set(captures.map((c) => c.id));
    for (const id of receipts) {
      if (!pendingIds.has(id)) {
        receipts.delete(id);
      }
    }
    return receipts;
  }
}
