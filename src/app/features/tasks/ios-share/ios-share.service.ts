import { DestroyRef, inject, Injectable, InjectionToken } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { registerPlugin } from '@capacitor/core';
import { Store } from '@ngrx/store';
import { concatMap, filter, firstValueFrom, startWith } from 'rxjs';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { Log } from '../../../core/log';
import { SnackService } from '../../../core/snack/snack.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { IS_IOS_NATIVE } from '../../../util/is-native-platform';
import { INBOX_PROJECT } from '../../project/project.const';
import { WorkContextType } from '../../work-context/work-context.model';
import { selectTaskEntities } from '../store/task.selectors';
import { DEFAULT_TASK } from '../task.model';
import { iosInterface } from '../../ios/ios-interface';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';

export interface IosSharePlugin {
  getPending(): Promise<{ shares: { id: string; title: string; text: string }[] }>;
  acknowledge(options: { id: string }): Promise<void>;
}

export const IOS_SHARE = new InjectionToken<IosSharePlugin | null>('IOS_SHARE', {
  providedIn: 'root',
  factory: () => (IS_IOS_NATIVE ? registerPlugin<IosSharePlugin>('ShareInbox') : null),
});

const RECEIPTS_KEY = 'sp-ios-share-receipts';

@Injectable({ providedIn: 'root' })
export class IosShareService {
  private _plugin = inject(IOS_SHARE);
  private _store = inject(Store);
  private _tasks = this._store.selectSignal(selectTaskEntities);
  private _dataInit = inject(DataInitStateService);
  private _syncTrigger = inject(SyncTriggerService);
  private _hydration = inject(HydrationStateService);
  private _flush = inject(OperationWriteFlushService);
  private _capture = inject(OperationCaptureService);
  private _destroyRef = inject(DestroyRef);
  private _snack = inject(SnackService);

  start(): void {
    if (!this._plugin) {
      return;
    }
    iosInterface.onResume$
      .pipe(
        startWith(null),
        concatMap(() =>
          this.importPending().catch(() => {
            // Native payloads and error objects can contain shared user content.
            Log.err('iOS share import failed; pending captures retained');
            this._snack.open({ type: 'ERROR', msg: 'F.IOS_SHARE.IMPORT_ERROR' });
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe();
  }

  /** Called serially at startup and on resume; the extension never writes app state. */
  async importPending(): Promise<void> {
    if (!this._plugin) {
      return;
    }
    await firstValueFrom(this._dataInit.isAllDataLoadedInitially$);
    await firstValueFrom(this._syncTrigger.afterInitialSyncDoneStrict$);
    const { shares } = await this._plugin.getPending();
    // Receipts bridge a failed native acknowledgement even if the user later
    // deletes/archives the task. They contain IDs only and are local to this device.
    const receipts = new Set<string>(
      JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]'),
    );
    const pendingIds = new Set(shares.map((share) => share.id));
    for (const id of receipts) {
      if (!pendingIds.has(id)) {
        receipts.delete(id);
      }
    }
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify([...receipts]));
    for (const share of shares) {
      // The native extension enforces the same existing external-input limits.
      // Check again before a bridge payload becomes a synced task.
      if (!share.text.trim() || share.text.length > 100_000) {
        throw new Error('Invalid shared text');
      }
      if (!receipts.has(share.id)) {
        // A resume can overlap replay. Wait without a timeout/fail-open path,
        // and recheck synchronously before dispatch so capture cannot be skipped.
        do {
          await firstValueFrom(
            this._hydration.isInSyncWindow$.pipe(filter((active) => !active)),
          );
        } while (this._hydration.isInSyncWindow());
        if (!this._tasks()[share.id]) {
          this._store.dispatch(
            TaskSharedActions.addTask({
              task: {
                ...DEFAULT_TASK,
                id: share.id,
                title: (share.title.trim() || share.text.trim().split('\n')[0]).slice(
                  0,
                  300,
                ),
                notes: share.text,
                projectId: INBOX_PROJECT.id,
                created: Date.now(),
              },
              workContextId: INBOX_PROJECT.id,
              workContextType: WorkContextType.PROJECT,
              isAddToBacklog: false,
              isAddToBottom: true,
              isIgnoreShortSyntax: true,
            }),
          );
        }
        // Flush drains writes even on failure; the sticky divergence marker is
        // essential here. Never acknowledge content that exists only in memory.
        await this._flush.flushPendingWrites();
        if (this._capture.hasUnrecoveredPersistFailure()) {
          throw new Error('Task persistence failed');
        }
        receipts.add(share.id);
        localStorage.setItem(RECEIPTS_KEY, JSON.stringify([...receipts]));
      }
      await this._plugin.acknowledge({ id: share.id });
      receipts.delete(share.id);
      localStorage.setItem(RECEIPTS_KEY, JSON.stringify([...receipts]));
    }
  }
}
