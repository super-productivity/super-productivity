import { inject, Injectable } from '@angular/core';
import { select, Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { TeamIssue, TeamState } from './team.model';
import {
  selectAllTeamIssues,
  selectTeamIsConnected,
  selectTeamIsSyncing,
  selectTeamLastSyncAt,
  selectActiveWorkspace,
  selectTeamProjects,
  selectTeamMembers,
  selectTeamLabels,
  selectTeamCycles,
  selectTeamWorkspaces,
  selectMyTeamIssues,
} from './store/team.reducer';
import {
  connectTeam,
  disconnectTeam,
  syncTeamIssues,
  updateTeamIssueStatus,
  uploadTimeEntries,
  loadWorkspaces,
  setActiveWorkspace,
  addTeamComment,
} from './store/team.actions';

@Injectable({ providedIn: 'root' })
export class TeamService {
  private _store$ = inject<Store<{ team: TeamState }>>(Store);

  // Observables
  issues$ = this._store$.pipe(select(selectAllTeamIssues));
  isConnected$ = this._store$.pipe(select(selectTeamIsConnected));
  isSyncing$ = this._store$.pipe(select(selectTeamIsSyncing));
  lastSyncAt$ = this._store$.pipe(select(selectTeamLastSyncAt));
  activeWorkspace$ = this._store$.pipe(select(selectActiveWorkspace));
  projects$ = this._store$.pipe(select(selectTeamProjects));
  members$ = this._store$.pipe(select(selectTeamMembers));
  labels$ = this._store$.pipe(select(selectTeamLabels));
  cycles$ = this._store$.pipe(select(selectTeamCycles));
  workspaces$ = this._store$.pipe(select(selectTeamWorkspaces));

  // Signals
  issues = toSignal(this.issues$, { initialValue: [] });
  isConnected = toSignal(this.isConnected$, { initialValue: false });
  isSyncing = toSignal(this.isSyncing$, { initialValue: false });
  lastSyncAt = toSignal(this.lastSyncAt$, { initialValue: null });
  activeWorkspace = toSignal(this.activeWorkspace$, { initialValue: null });
  projects = toSignal(this.projects$, { initialValue: [] });
  members = toSignal(this.members$, { initialValue: [] });

  connect(workspaceId: string): void {
    this._store$.dispatch(connectTeam({ workspaceId }));
  }

  disconnect(): void {
    this._store$.dispatch(disconnectTeam());
  }

  sync(): void {
    this._store$.dispatch(syncTeamIssues());
  }

  updateIssueStatus(issueId: string, status: TeamIssue['status']): void {
    this._store$.dispatch(updateTeamIssueStatus({ issueId, status }));
  }

  addComment(issueId: string, body: string): void {
    this._store$.dispatch(addTeamComment({ issueId, body }));
  }

  uploadTimeEntries(
    entries: {
      issueId: string;
      startedAt: number;
      endedAt: number;
      durationMs: number;
      spTaskId: string;
    }[],
  ): void {
    this._store$.dispatch(uploadTimeEntries({ entries }));
  }

  loadWorkspaces(): void {
    this._store$.dispatch(loadWorkspaces());
  }

  setActiveWorkspace(workspaceId: string): void {
    this._store$.dispatch(setActiveWorkspace({ workspaceId }));
  }

  getMyIssues(userId: string): Observable<TeamIssue[]> {
    return this._store$.pipe(select(selectMyTeamIssues(userId)));
  }
}
