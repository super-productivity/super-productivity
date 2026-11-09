import {
  hideAddTaskBar,
  hideNonTaskSidePanelContent,
  hidePluginPanel,
  showAddTaskBar,
  showPluginPanel,
  toggleIssuePanel,
  togglePluginPanel,
  toggleShowNotes,
} from './layout.actions';
import { toggleScheduleDayPanel, hideScheduleDayPanel } from './layout.actions';
import {
  Action,
  createFeatureSelector,
  createReducer,
  createSelector,
  on,
} from '@ngrx/store';

export const LAYOUT_FEATURE_NAME = 'layout';

export interface LayoutState {
  isShowAddTaskBar: boolean;
  isShowNotes: boolean;
  isShowIssuePanel: boolean;
  isShowCelebrate: boolean;
  isShowPluginPanel: boolean;
  activePluginId: string | null;
  isShowScheduleDayPanel: boolean;
}

export const INITIAL_LAYOUT_STATE: LayoutState = {
  isShowAddTaskBar: false,
  isShowNotes: false,
  isShowIssuePanel: false,
  isShowCelebrate: false,
  isShowPluginPanel: false,
  activePluginId: null,
  isShowScheduleDayPanel: false,
};

export const selectLayoutFeatureState =
  createFeatureSelector<LayoutState>(LAYOUT_FEATURE_NAME);

export const selectIsShowAddTaskBar = createSelector(
  selectLayoutFeatureState,
  (state) => state.isShowAddTaskBar,
);

export const selectIsShowNotes = createSelector(
  selectLayoutFeatureState,
  (state) => state.isShowNotes,
);

export const selectIsShowIssuePanel = createSelector(
  selectLayoutFeatureState,
  (state) => state.isShowIssuePanel,
);

export const selectIsShowCelebrate = createSelector(
  selectLayoutFeatureState,
  (state) => state.isShowCelebrate,
);

export const selectIsShowPluginPanel = createSelector(
  selectLayoutFeatureState,
  (state) => state.isShowPluginPanel,
);

export const selectActivePluginId = createSelector(
  selectLayoutFeatureState,
  (state) => state.activePluginId,
);

export const selectIsShowScheduleDayPanel = createSelector(
  selectLayoutFeatureState,
  (state) => state.isShowScheduleDayPanel,
);

const ALL_PANEL_CONTENT_HIDDEN: Partial<LayoutState> = {
  isShowNotes: false,
  isShowIssuePanel: false,
  isShowPluginPanel: false,
  activePluginId: null,
  isShowScheduleDayPanel: false,
};

const _reducer = createReducer<LayoutState>(
  INITIAL_LAYOUT_STATE,

  on(showAddTaskBar, (state) => ({ ...state, isShowAddTaskBar: true })),

  on(hideAddTaskBar, (state) => ({ ...state, isShowAddTaskBar: false })),

  on(toggleShowNotes, (state) => ({
    ...state,
    ...ALL_PANEL_CONTENT_HIDDEN,
    isShowNotes: !state.isShowNotes,
  })),

  on(hideNonTaskSidePanelContent, (state) => ({
    ...state,
    ...ALL_PANEL_CONTENT_HIDDEN,
  })),

  on(toggleIssuePanel, (state) => ({
    ...state,
    ...ALL_PANEL_CONTENT_HIDDEN,
    isShowIssuePanel: !state.isShowIssuePanel,
  })),

  on(showPluginPanel, (state, { pluginId }) => ({
    ...state,
    ...ALL_PANEL_CONTENT_HIDDEN,
    isShowPluginPanel: true,
    activePluginId: pluginId,
  })),

  on(hidePluginPanel, (state) => ({
    ...state,
    ...ALL_PANEL_CONTENT_HIDDEN,
    activePluginId: null,
  })),

  on(togglePluginPanel, (state, { pluginId }) => {
    const isCurrentlyActive =
      state.activePluginId === pluginId && state.isShowPluginPanel;
    return {
      ...state,
      ...ALL_PANEL_CONTENT_HIDDEN,
      isShowPluginPanel: !isCurrentlyActive,
      activePluginId: isCurrentlyActive ? null : pluginId,
    };
  }),
  on(toggleScheduleDayPanel, (state) => ({
    ...state,
    ...ALL_PANEL_CONTENT_HIDDEN,
    isShowScheduleDayPanel: !state.isShowScheduleDayPanel,
  })),
  on(hideScheduleDayPanel, (state) => ({
    ...state,
    ...ALL_PANEL_CONTENT_HIDDEN,
    isShowScheduleDayPanel: false,
  })),
);

export const layoutReducer = (
  state: LayoutState = INITIAL_LAYOUT_STATE,
  action: Action,
): LayoutState => _reducer(state, action);
