import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { from, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TrashStoreService } from '../../../op-log/persistence/trash-store.service';
import { TrashActions } from './trash.actions';
import { TrashedItem } from '../trash.model';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { GlobalConfigService } from '../../config/global-config.service';
import { Log } from '../../../core/log';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TrashEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _trashStore = inject(TrashStoreService);
  private readonly _snack = inject(SnackService);
  private readonly _globalConfig = inject(GlobalConfigService);

  /** Persist trashed items to IndexedDB and show an undo snackbar. */
  persistOnMoveToTrash$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TrashActions.moveToTrash),
        tap(({ items }) => {
          if (items.length === 0) return;
          this._trashStore.put(items).catch((e) => {
            Log.err('[Trash] Failed to persist moveToTrash', e);
          });
          const first = items[0];
          this._snack.open({
            msg: T.TRASH.MOVED_TO_TRASH,
            ico: 'delete',
            config: { duration: 5000 },
            actionStr: T.TRASH.UNDO,
            actionFn: () => {
              this._store.dispatch(
                TrashActions.restoreFromTrash({
                  itemId: first.id,
                  entityType: first.entityType,
                }),
              );
            },
          });
        }),
      ),
    { dispatch: false },
  );

  persistOnRestore$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TrashActions.restoreFromTrash),
        tap(({ itemId }) => {
          this._trashStore.remove([itemId]).catch((e) => {
            Log.err('[Trash] Failed to remove restored item from IDB', e);
          });
          this._snack.open({ msg: T.TRASH.RESTORED, ico: 'restore_from_trash' });
        }),
      ),
    { dispatch: false },
  );

  persistOnPermanentDelete$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TrashActions.permanentlyDeleteFromTrash),
        tap(({ itemIds }) => {
          this._trashStore.remove(itemIds).catch((e) => {
            Log.err('[Trash] Failed to remove items from IDB', e);
          });
        }),
      ),
    { dispatch: false },
  );

  persistOnEmptyTrash$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TrashActions.emptyTrash),
        tap(() => {
          this._trashStore.clear().catch((e) => {
            Log.err('[Trash] Failed to clear trash IDB store', e);
          });
        }),
      ),
    { dispatch: false },
  );

  /**
   * Load trash from IndexedDB and purge expired items on app startup.
   *
   * Selector-based effect (listening to a config emission) is intentional here:
   * we need to wait until the global config is loaded to know retentionDays,
   * and then hydrate exactly once.
   */
  loadTrashOnInit$ = createEffect(() =>
    from(this._loadAndPurge()).pipe(
      map((items) => TrashActions.loadTrashSuccess({ items })),
      catchError((e) => {
        Log.err('[Trash] Failed to load trash from IDB', e);
        return of(TrashActions.loadTrashSuccess({ items: [] }));
      }),
    ),
  );

  private async _loadAndPurge(): Promise<TrashedItem[]> {
    // cfg() may briefly be undefined on startup before hydration; in that
    // case defer purge and just return whatever is in IDB — the next effect
    // run after hydration will pick it up.
    const cfg = this._globalConfig.cfg();
    if (!cfg) {
      return this._trashStore.getAll();
    }
    const retentionMs = cfg.trash.retentionDays * DAY_MS;
    const cutoff = Date.now() - retentionMs;
    try {
      await this._trashStore.removeExpired(cutoff);
    } catch (e) {
      Log.err('[Trash] Failed to purge expired items', e);
    }
    return this._trashStore.getAll();
  }
}
