import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Store } from '@ngrx/store';
import {
  TeamCycle,
  TeamIssue,
  TeamLabel,
  TeamMember,
  TeamProject,
  TeamWorkspace,
} from './team.model';
import { selectTeamConfig } from '../config/store/global-config.reducer';
import { first, switchMap } from 'rxjs/operators';

interface ConnectResult {
  workspace: TeamWorkspace;
  members: TeamMember[];
}

interface SyncResult {
  issues: TeamIssue[];
  projects: TeamProject[];
  labels: TeamLabel[];
  cycles: TeamCycle[];
}

@Injectable({ providedIn: 'root' })
export class TeamApiService {
  private _http = inject(HttpClient);
  private _store$ = inject(Store);

  private _getBaseUrl(): Observable<string> {
    return this._store$.select(selectTeamConfig).pipe(
      first(),
      switchMap((cfg) => {
        if (!cfg.serverUrl) {
          throw new Error('Team server URL is not configured');
        }
        return [cfg.serverUrl];
      }),
    );
  }

  private _getHeaders(): Observable<{ Authorization: string }> {
    return this._store$.select(selectTeamConfig).pipe(
      first(),
      switchMap((cfg) => {
        if (!cfg.apiToken) {
          throw new Error('Team API token is not configured');
        }
        return [{ Authorization: `Bearer ${cfg.apiToken}` }];
      }),
    );
  }

  getWorkspaces(): Observable<TeamWorkspace[]> {
    return this._getBaseUrl().pipe(
      switchMap((baseUrl) =>
        this._getHeaders().pipe(
          switchMap((headers) =>
            this._http.get<TeamWorkspace[]>(`${baseUrl}/api/v1/workspaces`, {
              headers,
            }),
          ),
        ),
      ),
    );
  }

  connectToWorkspace(workspaceId: string): Observable<ConnectResult> {
    return this._getBaseUrl().pipe(
      switchMap((baseUrl) =>
        this._getHeaders().pipe(
          switchMap((headers) =>
            this._http.get<ConnectResult>(
              `${baseUrl}/api/v1/workspaces/${workspaceId}/connect`,
              { headers },
            ),
          ),
        ),
      ),
    );
  }

  syncIssues(updatedSince: number | null): Observable<SyncResult> {
    return this._getBaseUrl().pipe(
      switchMap((baseUrl) =>
        this._getHeaders().pipe(
          switchMap((headers) => {
            let params = new HttpParams();
            if (updatedSince) {
              params = params.set('updated_since', updatedSince.toString());
            }
            return this._http.get<SyncResult>(`${baseUrl}/api/v1/my/issues`, {
              headers,
              params,
            });
          }),
        ),
      ),
    );
  }

  updateIssueStatus(issueId: string, status: TeamIssue['status']): Observable<TeamIssue> {
    return this._getBaseUrl().pipe(
      switchMap((baseUrl) =>
        this._getHeaders().pipe(
          switchMap((headers) =>
            this._http.patch<TeamIssue>(
              `${baseUrl}/api/v1/issues/${issueId}`,
              { status },
              { headers },
            ),
          ),
        ),
      ),
    );
  }

  addComment(issueId: string, body: string): Observable<{ id: string }> {
    return this._getBaseUrl().pipe(
      switchMap((baseUrl) =>
        this._getHeaders().pipe(
          switchMap((headers) =>
            this._http.post<{ id: string }>(
              `${baseUrl}/api/v1/issues/${issueId}/comments`,
              { body },
              { headers },
            ),
          ),
        ),
      ),
    );
  }

  uploadTimeEntries(
    entries: {
      issueId: string;
      startedAt: number;
      endedAt: number;
      durationMs: number;
      spTaskId: string;
    }[],
  ): Observable<void> {
    return this._getBaseUrl().pipe(
      switchMap((baseUrl) =>
        this._getHeaders().pipe(
          switchMap((headers) =>
            this._http.post<void>(
              `${baseUrl}/api/v1/time-entries`,
              { entries },
              { headers },
            ),
          ),
        ),
      ),
    );
  }
}
