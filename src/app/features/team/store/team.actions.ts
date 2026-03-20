import { createAction, props } from '@ngrx/store';
import {
  TeamCycle,
  TeamIssue,
  TeamLabel,
  TeamMember,
  TeamProject,
  TeamState,
  TeamWorkspace,
} from '../team.model';

// Connection
export const connectTeam = createAction(
  '[Team] Connect',
  props<{ workspaceId: string }>(),
);

export const connectTeamSuccess = createAction(
  '[Team] Connect Success',
  props<{ workspace: TeamWorkspace; members: TeamMember[] }>(),
);

export const connectTeamFailure = createAction(
  '[Team] Connect Failure',
  props<{ error: string }>(),
);

export const disconnectTeam = createAction('[Team] Disconnect');

// Sync
export const syncTeamIssues = createAction('[Team] Sync Issues');

export const syncTeamIssuesSuccess = createAction(
  '[Team] Sync Issues Success',
  props<{
    issues: TeamIssue[];
    projects: TeamProject[];
    labels: TeamLabel[];
    cycles: TeamCycle[];
    lastSyncAt: number;
  }>(),
);

export const syncTeamIssuesFailure = createAction(
  '[Team] Sync Issues Failure',
  props<{ error: string }>(),
);

// Issues
export const updateTeamIssueStatus = createAction(
  '[Team] Update Issue Status',
  props<{ issueId: string; status: TeamIssue['status'] }>(),
);

export const updateTeamIssueStatusSuccess = createAction(
  '[Team] Update Issue Status Success',
  props<{ issue: TeamIssue }>(),
);

export const addTeamComment = createAction(
  '[Team] Add Comment',
  props<{ issueId: string; body: string }>(),
);

// Time entries
export const uploadTimeEntries = createAction(
  '[Team] Upload Time Entries',
  props<{
    entries: {
      issueId: string;
      startedAt: number;
      endedAt: number;
      durationMs: number;
      spTaskId: string;
    }[];
  }>(),
);

export const uploadTimeEntriesSuccess = createAction(
  '[Team] Upload Time Entries Success',
);

// Workspaces
export const loadWorkspaces = createAction('[Team] Load Workspaces');

export const loadWorkspacesSuccess = createAction(
  '[Team] Load Workspaces Success',
  props<{ workspaces: TeamWorkspace[] }>(),
);

export const setActiveWorkspace = createAction(
  '[Team] Set Active Workspace',
  props<{ workspaceId: string }>(),
);

// Load all data (hydration)
export const loadTeamState = createAction(
  '[Team] Load State',
  props<{ state: TeamState }>(),
);
