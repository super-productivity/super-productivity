import { TeamState } from './team.model';

export const TEAM_FEATURE_NAME = 'team' as const;

export const DEFAULT_TEAM_STATE: TeamState = {
  ids: [],
  entities: {},
  isConnected: false,
  lastSyncAt: null,
  activeWorkspaceId: null,
  workspaces: [],
  projects: [],
  members: [],
  labels: [],
  cycles: [],
  isSyncing: false,
};
