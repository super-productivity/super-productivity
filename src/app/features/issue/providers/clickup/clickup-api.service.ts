import {
  HttpClient,
  HttpHeaders,
  HttpParams,
  HttpErrorResponse,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of, throwError, timer } from 'rxjs';
import { catchError, map, switchMap, retry } from 'rxjs/operators';
import typia from 'typia';
import { IssueLog } from '../../../../core/log';
import { SnackService } from '../../../../core/snack/snack.service';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';
import { CLICKUP_TYPE } from '../../issue.const';
import { CLICKUP_HEADER_RATE_LIMIT_RESET } from './clickup.const';
import {
  ClickUpTask,
  ClickUpTaskReduced,
  ClickUpTaskSearchResponse,
  ClickUpTeamsResponse,
  ClickUpUserResponse,
} from './clickup-issue.model';
import { ClickUpCfg } from './clickup.model';

const CLICKUP_API_URL = 'https://api.clickup.com/api/v2';

@Injectable({
  providedIn: 'root',
})
export class ClickUpApiService {
  private _snackService = inject(SnackService);
  private _http = inject(HttpClient);

  getById$(taskId: string, cfg: ClickUpCfg): Observable<ClickUpTask> {
    const params = new HttpParams()
      .set('include_markdown_description', 'true')
      .set('include_subtasks', 'true');

    return this._sendRequest$({
      url: `${CLICKUP_API_URL}/task/${taskId}`,
      params,
      cfg,
      validator: (res) => typia.assert<ClickUpTask>(res),
    });
  }

  getAuthorizedTeams$(cfg: ClickUpCfg): Observable<Array<{ id: string; name: string }>> {
    return this._sendRequest$({
      url: `${CLICKUP_API_URL}/team`,
      cfg,
      validator: (res) =>
        typia.assert<ClickUpTeamsResponse>(res).teams.map((team) => ({
          id: team.id,
          name: team.name,
        })),
    });
  }

  searchTasks$(searchTerm: string, cfg: ClickUpCfg): Observable<ClickUpTaskReduced[]> {
    // If teamIds are configured, search only in those teams
    if (cfg.teamIds && cfg.teamIds.length > 0) {
      return this._searchTasksInTeams$(searchTerm, cfg.teamIds, cfg);
    }

    // If no teamIds are configured, fetch all authorized teams and search across all of them
    return this.getAuthorizedTeams$(cfg).pipe(
      switchMap((teams) => {
        if (!teams || teams.length === 0) {
          IssueLog.warn('No authorized teams found');
          return of([]);
        }

        const teamIds = teams.map((team) => team.id);
        return this._searchTasksInTeams$(searchTerm, teamIds, cfg);
      }),
    );
  }

  private _searchTasksInTeams$(
    searchTerm: string,
    teamIds: string[],
    cfg: ClickUpCfg,
  ): Observable<ClickUpTaskReduced[]> {
    // Search tasks in all teams in parallel
    const searchObservables = teamIds.map((teamId) =>
      this._searchTasksInTeam$(searchTerm, teamId, cfg).pipe(
        catchError((err) => {
          IssueLog.warn(`Failed to search tasks in team ${teamId}:`, err);
          return of([]);
        }),
      ),
    );

    return forkJoin(searchObservables).pipe(
      map((results) => {
        // Flatten all results from all teams
        return results.flat();
      }),
    );
  }

  private _searchTasksInTeam$(
    searchTerm: string,
    teamId: string,
    cfg: ClickUpCfg,
  ): Observable<ClickUpTaskReduced[]> {
    let params = new HttpParams().set('page', '0').set('subtasks', 'true');

    // Add assignee filter if userId is available
    if (cfg.userId) {
      params = params.set('assignees[]', cfg.userId.toString());
    }

    return this._sendRequest$({
      url: `${CLICKUP_API_URL}/team/${teamId}/task`,
      params,
      cfg,
      validator: (res) => {
        const body = typia.assert<ClickUpTaskSearchResponse>(res);
        let tasks = body.tasks;
        if (searchTerm.trim()) {
          const lowerSearchTerm = searchTerm.toLowerCase();
          tasks = tasks.filter(
            (task) =>
              task.name.toLowerCase().includes(lowerSearchTerm) ||
              (task.custom_id &&
                task.custom_id.toLowerCase().includes(lowerSearchTerm)) ||
              task.id.includes(lowerSearchTerm),
          );
        }
        return tasks.map(this._mapToReduced);
      },
    });
  }

  getCurrentUser$(cfg: ClickUpCfg): Observable<ClickUpUserResponse> {
    return this._sendRequest$({
      url: `${CLICKUP_API_URL}/user`,
      cfg,
      validator: (res) => typia.assert<ClickUpUserResponse>(res),
    });
  }

  private _getHeaders(cfg: ClickUpCfg): HttpHeaders {
    return new HttpHeaders({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      Authorization: cfg.apiKey || '',
    });
  }

  private _sendRequest$<T>({
    url,
    params,
    cfg,
    validator,
  }: {
    url: string;
    params?: HttpParams;
    cfg: ClickUpCfg;
    validator?: (res: unknown) => T;
  }): Observable<T> {
    const headers = this._getHeaders(cfg);

    return this._http
      .get<T>(url, {
        headers,
        params,
        reportProgress: false,
        observe: 'response',
      })
      .pipe(
        // Retry with backoff on 429
        retry({
          count: 3,
          delay: (error: HttpErrorResponse, retryCount) => {
            if (error.status === 429) {
              const resetHeader = error.headers.get(CLICKUP_HEADER_RATE_LIMIT_RESET);
              if (resetHeader) {
                const resetTime = parseInt(resetHeader, 10) * 1000;
                const waitTime = resetTime - Date.now();
                if (waitTime > 0) {
                  IssueLog.warn(
                    `ClickUp: Rate limit exceeded. Waiting for ${waitTime}ms before retry ${retryCount}.`,
                  );
                  return timer(waitTime);
                }
              }
              // Fallback to exponential backoff if no header or invalid
              const delay = 1000 * Math.pow(2, retryCount - 1);
              IssueLog.warn(
                `ClickUp: Rate limit exceeded. Waiting for ${delay}ms (backoff) before retry ${retryCount}.`,
              );
              return timer(delay);
            }
            return throwError(() => error);
          },
        }),
        map((res: HttpResponse<T>) => (res && res.body ? res.body : res)),
        map((res) => {
          if (validator) {
            return validator(res);
          }
          return res as T;
        }),
        catchError((err) =>
          handleIssueProviderHttpError$<T>(CLICKUP_TYPE, this._snackService, err),
        ),
      );
  }

  private _mapToReduced(task: ClickUpTask): ClickUpTaskReduced {
    return {
      id: task.id,
      name: task.name,
      status: task.status,
      date_updated: task.date_updated,
      url: task.url,
      custom_id: task.custom_id,
    };
  }
}
