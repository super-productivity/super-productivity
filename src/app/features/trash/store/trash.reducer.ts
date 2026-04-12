import { createFeature, createReducer, createSelector, on } from '@ngrx/store';
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { TrashedItem, TrashedTask } from '../trash.model';
import { TrashActions } from './trash.actions';

export const TRASH_FEATURE_NAME = 'trash';

export interface TrashState extends EntityState<TrashedItem> {
  loaded: boolean;
}

export const trashAdapter = createEntityAdapter<TrashedItem>({
  selectId: (item) => item.id,
  // Newest-deleted items first.
  sortComparer: (a, b) => b.deletedAt - a.deletedAt,
});

export const initialTrashState: TrashState = trashAdapter.getInitialState({
  loaded: false,
});

const reducer = createReducer(
  initialTrashState,
  on(TrashActions.loadTrashSuccess, (state, { items }) =>
    trashAdapter.setAll(items, { ...state, loaded: true }),
  ),
  on(TrashActions.moveToTrash, (state, { items }) => trashAdapter.addMany(items, state)),
  on(TrashActions.restoreFromTrash, (state, { itemId }) =>
    trashAdapter.removeOne(itemId, state),
  ),
  on(TrashActions.permanentlyDeleteFromTrash, (state, { itemIds }) =>
    trashAdapter.removeMany(itemIds, state),
  ),
  on(TrashActions.emptyTrash, (state) => trashAdapter.removeAll(state)),
);

export const trashFeature = createFeature({
  name: TRASH_FEATURE_NAME,
  reducer,
  extraSelectors: ({ selectTrashState }) => {
    const { selectAll, selectTotal } = trashAdapter.getSelectors();
    const selectAllTrashedItems = createSelector(selectTrashState, selectAll);
    return {
      selectAllTrashedItems,
      selectTrashItemCount: createSelector(selectTrashState, selectTotal),
      selectTrashedTaskItems: createSelector(
        selectAllTrashedItems,
        (items): TrashedTask[] =>
          items.filter((i): i is TrashedTask => i.entityType === 'TASK'),
      ),
    };
  },
});

export const { selectAllTrashedItems, selectTrashItemCount, selectTrashedTaskItems } =
  trashFeature;

export const trashReducer = trashFeature.reducer;
