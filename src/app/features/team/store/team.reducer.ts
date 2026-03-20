import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import {
  createFeatureSelector,
  createReducer,
  createSelector,
  MemoizedSelector,
  on,
} from '@ngrx/store';
import { TeamIssue, TeamState } from '../team.model';
import { TEAM_FEATURE_NAME, DEFAULT_TEAM_STATE } from '../team.const';
import {
  connectTeamSuccess,
  connectTeamFailure,
  disconnectTeam,
  syncTeamIssues,
  syncTeamIssuesSuccess,
  syncTeamIssuesFailure,
  updateTeamIssueStatusSuccess,
  loadWorkspacesSuccess,
  setActiveWorkspace,
  loadTeamState,
} from './team.actions';

export { TEAM_FEATURE_NAME };

export const teamAdapter: EntityAdapter<TeamIssue> = createEntityAdapter<TeamIssue>();

const initialState: TeamState = teamAdapter.getInitialState(DEFAULT_TEAM_STATE);

// Selectors
export const selectTeamFeatureState = createFeatureSelector<TeamState>(TEAM_FEATURE_NAME);

const { selectAll, selectEntities } = teamAdapter.getSelectors();

export const selectAllTeamIssues = createSelector(selectTeamFeatureState, selectAll);

export const selectTeamIssueEntities = createSelector(
  selectTeamFeatureState,
  selectEntities,
);

export const selectTeamIsConnected = createSelector(
  selectTeamFeatureState,
  (state): boolean => state.isConnected,
);

export const selectTeamIsSyncing = createSelector(
  selectTeamFeatureState,
  (state): boolean => state.isSyncing,
);

export const selectTeamLastSyncAt = createSelector(
  selectTeamFeatureState,
  (state): number | null => state.lastSyncAt,
);

export const selectTeamWorkspaces = createSelector(
  selectTeamFeatureState,
  (state) => state.workspaces,
);

export const selectActiveWorkspaceId = createSelector(
  selectTeamFeatureState,
  (state) => state.activeWorkspaceId,
);

export const selectActiveWorkspace = createSelector(
  selectTeamFeatureState,
  (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null,
);

export const selectTeamProjects = createSelector(
  selectTeamFeatureState,
  (state) => state.projects,
);

export const selectTeamMembers = createSelector(
  selectTeamFeatureState,
  (state) => state.members,
);

export const selectTeamLabels = createSelector(
  selectTeamFeatureState,
  (state) => state.labels,
);

export const selectTeamCycles = createSelector(
  selectTeamFeatureState,
  (state) => state.cycles,
);

export const selectTeamIssuesByProject = (
  projectId: string,
): MemoizedSelector<object, TeamIssue[]> =>
  createSelector(selectAllTeamIssues, (issues: TeamIssue[]) =>
    issues.filter((i) => i.projectId === projectId),
  );

export const selectTeamIssuesByStatus = (
  status: TeamIssue['status'],
): MemoizedSelector<object, TeamIssue[]> =>
  createSelector(selectAllTeamIssues, (issues: TeamIssue[]) =>
    issues.filter((i) => i.status === status),
  );

export const selectMyTeamIssues = (
  userId: string,
): MemoizedSelector<object, TeamIssue[]> =>
  createSelector(selectAllTeamIssues, (issues: TeamIssue[]) =>
    issues.filter((i) => i.assigneeId === userId),
  );

// Reducer
export const teamReducer = createReducer<TeamState>(
  initialState,
  on(loadTeamState, (state, { state: loadedState }) => ({
    ...state,
    ...loadedState,
  })),
  on(connectTeamSuccess, (state, { workspace, members }) => ({
    ...state,
    isConnected: true,
    activeWorkspaceId: workspace.id,
    workspaces: state.workspaces.some((w) => w.id === workspace.id)
      ? state.workspaces
      : [...state.workspaces, workspace],
    members,
  })),
  on(connectTeamFailure, (state) => ({
    ...state,
    isConnected: false,
  })),
  on(disconnectTeam, (state) =>
    teamAdapter.removeAll({
      ...state,
      isConnected: false,
      activeWorkspaceId: null,
      members: [],
      projects: [],
      labels: [],
      cycles: [],
      isSyncing: false,
    }),
  ),
  on(syncTeamIssues, (state) => ({
    ...state,
    isSyncing: true,
  })),
  on(syncTeamIssuesSuccess, (state, { issues, projects, labels, cycles, lastSyncAt }) =>
    teamAdapter.setAll(issues, {
      ...state,
      projects,
      labels,
      cycles,
      lastSyncAt,
      isSyncing: false,
    }),
  ),
  on(syncTeamIssuesFailure, (state) => ({
    ...state,
    isSyncing: false,
  })),
  on(updateTeamIssueStatusSuccess, (state, { issue }) =>
    teamAdapter.upsertOne(issue, state),
  ),
  on(loadWorkspacesSuccess, (state, { workspaces }) => ({
    ...state,
    workspaces,
  })),
  on(setActiveWorkspace, (state, { workspaceId }) => ({
    ...state,
    activeWorkspaceId: workspaceId,
  })),
);
