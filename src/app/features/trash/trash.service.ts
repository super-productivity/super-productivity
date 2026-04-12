import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { TrashActions } from './store/trash.actions';
import {
  selectAllTrashedItems,
  selectTrashedTaskItems,
  selectTrashItemCount,
} from './store/trash.reducer';
import { TrashedItem, TrashEntityType } from './trash.model';

@Injectable({ providedIn: 'root' })
export class TrashService {
  private readonly _store = inject(Store);

  readonly trashedItems = toSignal(this._store.select(selectAllTrashedItems), {
    initialValue: [] as TrashedItem[],
  });

  readonly trashedTasks = toSignal(this._store.select(selectTrashedTaskItems), {
    initialValue: [],
  });

  readonly trashItemCount = toSignal(this._store.select(selectTrashItemCount), {
    initialValue: 0,
  });

  moveToTrash(items: TrashedItem[]): void {
    if (items.length === 0) return;
    this._store.dispatch(TrashActions.moveToTrash({ items }));
  }

  restore(itemId: string, entityType: TrashEntityType): void {
    this._store.dispatch(TrashActions.restoreFromTrash({ itemId, entityType }));
  }

  permanentlyDelete(itemIds: string[]): void {
    if (itemIds.length === 0) return;
    this._store.dispatch(TrashActions.permanentlyDeleteFromTrash({ itemIds }));
  }

  emptyTrash(): void {
    this._store.dispatch(TrashActions.emptyTrash());
  }
}
