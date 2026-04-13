import { createFeature, createReducer, on } from '@ngrx/store';
import { AppStateActions } from './app-state.actions';
import { getDbDateStr } from '../../util/get-db-date-str';

export const appStateFeatureKey = 'appState';

export interface AppState {
  todayStr: string;
  startOfNextDayDiffMs: number;
}

export const appStateInitialState: AppState = {
  todayStr: getDbDateStr(),
  startOfNextDayDiffMs: 0,
};

export const appStateReducer = createReducer(
  appStateInitialState,
  on(AppStateActions.setTodayString, (state, { todayStr, startOfNextDayDiffMs }) => ({
    ...state,
    todayStr,
    startOfNextDayDiffMs,
  })),
);

export const appStateFeature = createFeature({
  name: appStateFeatureKey,
  reducer: appStateReducer,
});
