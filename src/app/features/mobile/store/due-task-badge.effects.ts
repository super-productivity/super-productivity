import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { tap } from 'rxjs/operators';
import { DueTaskBadgeService } from '../../../core/platform/due-task-badge.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import {
  selectTodayStr,
  selectStartOfNextDayDiffMs,
} from '../../../root-store/app-state/app-state.selectors';
import { selectTaskSchedulingSnapshot } from '../../tasks/store/task.selectors';
import { createDueTaskBadgeCount$ } from '../../tasks/util/due-task-badge-count$';

/**
 * Syncs the due-task app-icon badge on mobile (iOS now; Android via #11147).
 * Shares isShowDueTaskBadge + countDueTasks with the desktop effect.
 */
@Injectable()
export class DueTaskBadgeEffects {
  private readonly _store = inject(Store);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _badge = inject(DueTaskBadgeService);
  private readonly _hydrationState = inject(HydrationStateService);
  private readonly _syncTrigger = inject(SyncTriggerService);

  syncDueTaskBadge$ = createEffect(
    () =>
      createDueTaskBadgeCount$(
        this._store.select(selectTaskSchedulingSnapshot),
        this._store.select(selectTodayStr),
        this._store.select(selectStartOfNextDayDiffMs),
        this._configService.misc$,
        this._hydrationState.isInSyncWindow$,
        this._syncTrigger.initialSyncGateOpen$,
      ).pipe(
        tap((count) => {
          void this._badge.setCount(count);
        }),
      ),
    { dispatch: false },
  );
}
