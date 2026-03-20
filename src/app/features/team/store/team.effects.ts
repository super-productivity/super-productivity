import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, exhaustMap, map, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TeamApiService } from '../team-api.service';
import {
  connectTeam,
  connectTeamSuccess,
  connectTeamFailure,
  syncTeamIssues,
  syncTeamIssuesSuccess,
  syncTeamIssuesFailure,
  updateTeamIssueStatus,
  updateTeamIssueStatusSuccess,
  uploadTimeEntries,
  uploadTimeEntriesSuccess,
  loadWorkspaces,
  loadWorkspacesSuccess,
} from './team.actions';
import { selectTeamLastSyncAt } from './team.reducer';
import { SnackService } from '../../../core/snack/snack.service';

@Injectable()
export class TeamEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject(Store);
  private _teamApi = inject(TeamApiService);
  private _snackService = inject(SnackService);

  connect$ = createEffect(() =>
    this._actions$.pipe(
      ofType(connectTeam),
      exhaustMap(({ workspaceId }) =>
        this._teamApi.connectToWorkspace(workspaceId).pipe(
          map((result) =>
            connectTeamSuccess({
              workspace: result.workspace,
              members: result.members,
            }),
          ),
          catchError((error) =>
            of(connectTeamFailure({ error: error?.message || 'Connection failed' })),
          ),
        ),
      ),
    ),
  );

  onConnectSuccess$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(connectTeamSuccess),
        tap(() => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: 'Connected to team workspace',
          });
        }),
      ),
    { dispatch: false },
  );

  onConnectFailure$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(connectTeamFailure),
        tap(({ error }) => {
          this._snackService.open({
            type: 'ERROR',
            msg: 'Failed to connect to team: ' + error,
          });
        }),
      ),
    { dispatch: false },
  );

  syncIssues$ = createEffect(() =>
    this._actions$.pipe(
      ofType(syncTeamIssues),
      withLatestFrom(this._store$.select(selectTeamLastSyncAt)),
      exhaustMap(([, lastSyncAt]) =>
        this._teamApi.syncIssues(lastSyncAt).pipe(
          map((result) =>
            syncTeamIssuesSuccess({
              issues: result.issues,
              projects: result.projects,
              labels: result.labels,
              cycles: result.cycles,
              lastSyncAt: Date.now(),
            }),
          ),
          catchError((error) =>
            of(syncTeamIssuesFailure({ error: error?.message || 'Sync failed' })),
          ),
        ),
      ),
    ),
  );

  updateIssueStatus$ = createEffect(() =>
    this._actions$.pipe(
      ofType(updateTeamIssueStatus),
      switchMap(({ issueId, status }) =>
        this._teamApi.updateIssueStatus(issueId, status).pipe(
          map((issue) => updateTeamIssueStatusSuccess({ issue })),
          catchError((error) => {
            this._snackService.open({
              type: 'ERROR',
              msg: 'Failed to update issue status: ' + (error?.message || 'Unknown'),
            });
            return of();
          }),
        ),
      ),
    ),
  );

  uploadTimeEntries$ = createEffect(() =>
    this._actions$.pipe(
      ofType(uploadTimeEntries),
      exhaustMap(({ entries }) =>
        this._teamApi.uploadTimeEntries(entries).pipe(
          map(() => uploadTimeEntriesSuccess()),
          catchError((error) => {
            this._snackService.open({
              type: 'ERROR',
              msg: 'Failed to upload time entries: ' + (error?.message || 'Unknown'),
            });
            return of();
          }),
        ),
      ),
    ),
  );

  loadWorkspaces$ = createEffect(() =>
    this._actions$.pipe(
      ofType(loadWorkspaces),
      exhaustMap(() =>
        this._teamApi.getWorkspaces().pipe(
          map((workspaces) => loadWorkspacesSuccess({ workspaces })),
          catchError((error) => {
            this._snackService.open({
              type: 'ERROR',
              msg: 'Failed to load workspaces: ' + (error?.message || 'Unknown'),
            });
            return of();
          }),
        ),
      ),
    ),
  );

  syncOnConnect$ = createEffect(() =>
    this._actions$.pipe(
      ofType(connectTeamSuccess),
      map(() => syncTeamIssues()),
    ),
  );
}
