import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as fromAppState from './app-state.reducer';

export const selectAppStateState = createFeatureSelector<fromAppState.AppState>(
  fromAppState.appStateFeatureKey,
);

export const selectTodayStr = createSelector(
  selectAppStateState,
  (state: fromAppState.AppState) => state.todayStr,
);

export const selectStartOfNextDayDiffMs = createSelector(
  selectAppStateState,
  (state: fromAppState.AppState) => state.startOfNextDayDiffMs,
);
