import { Injectable, inject } from '@angular/core';
import { SnackService } from '../../../../core/snack/snack.service';
import { HttpClient, HttpHeaders, HttpParams, HttpRequest } from '@angular/common/http';
import { RedmineCfg } from './redmine.model';
import { catchError, filter, map, switchMap } from 'rxjs/operators';
import { forkJoin, Observable, of, throwError } from 'rxjs';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { T } from '../../../../t.const';
import { ISSUE_PROVIDER_HUMANIZED, REDMINE_TYPE } from '../../issue.const';
import {
  RedmineActivity,
  RedmineActivityResult,
  RedmineIssue,
  RedmineIssueResult,
  RedmineIssueStatusOptions,
  RedmineSearchResult,
  RedmineSearchResultItem,
  RedmineTimeEntriesResult,
} from './redmine-issue.model';
import {
  mapRedmineIssueToSearchResult,
  mapRedmineSearchResultItemToSearchResult,
} from './redmine-issue-map.util';
import { SearchResultItem } from '../../issue.model';
import { ScopeOptions } from './redmine.const';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';

/* eslint-disable @typescript-eslint/naming-convention */

const ISSUE_ID_QUERY_RGX = /^#?(\d+)$/;

@Injectable({
  providedIn: 'root',
})
export class RedmineApiService {
  private _snackService = inject(SnackService);
  private _http = inject(HttpClient);

  searchIssuesInProject$(query: string, cfg: RedmineCfg): Observable<SearchResultItem[]> {
    const searchResults$ = this._searchTextIssuesInProject$(query, cfg);
    const idMatch = query.trim().match(ISSUE_ID_QUERY_RGX);

    if (!idMatch && !queryHasNonAscii(query)) {
      return searchResults$;
    }

    const issueById$: Observable<RedmineIssue | null> = idMatch
      ? this._getIssueByIdInProject$(Number(idMatch[1]), cfg).pipe(
          catchError(() => of(null)),
        )
      : of(null);

    return forkJoin([issueById$, searchResults$]).pipe(
      switchMap(([issueById, searchResults]) => {
        const resultsWithId = issueById
          ? mergeSearchResults([mapRedmineIssueToSearchResult(issueById)], searchResults)
          : searchResults;

        return queryHasNonAscii(query) && resultsWithId.length === 0
          ? this._searchIssuesBySubjectInProject$(query, cfg).pipe(
              map((subjectResults) => mergeSearchResults(resultsWithId, subjectResults)),
              catchError(() => of(resultsWithId)),
            )
          : of(resultsWithId);
      }),
    );
  }

  // Looks up a single issue by id. When a project is configured the lookup stays scoped
  // to it (via the `/projects/<id>` URL segment), so a provider for one project can never
  // surface (or add) an issue from another project the API key happens to have access to.
  // When no project is configured (global mode) the lookup runs against the instance-wide
  // `/issues.json`, intentionally surfacing the matching issue from whatever project it
  // belongs to. Redmine resolves the project from the URL, so the scoped form works whether
  // `cfg.projectId` is the numeric id or the identifier slug. `status_id=*` ensures closed
  // issues are found too. An unknown (or out-of-scope) id simply yields an empty list ->
  // null, and the caller falls back to text search.
  private _getIssueByIdInProject$(
    issueId: number,
    cfg: RedmineCfg,
  ): Observable<RedmineIssue | null> {
    return this._sendRequest$(
      {
        url: `${cfg.host}${this._projectScopePath(cfg)}/issues.json`,
        params: ParamsBuilder.create()
          .withParam('issue_id', String(issueId))
          .withState(RedmineIssueStatusOptions.all)
          .withLimit(1)
          .build(),
      },
      cfg,
      { isSkipErrorHandling: true },
    ).pipe(map((res: RedmineIssueResult) => res?.issues?.[0] ?? null));
  }

  getLast100IssuesForCurrentRedmineProject$(cfg: RedmineCfg): Observable<RedmineIssue[]> {
    return this._sendRequest$(
      {
        url: `${cfg.host}${this._projectScopePath(cfg)}/issues.json`,
        params: ParamsBuilder.create().withLimit(100).withScopeFrom(cfg).build(),
      },
      cfg,
    ).pipe(map((res: RedmineIssueResult) => (res && res.issues ? res.issues : [])));
  }

  getActivitiesForTrackTime$(cfg: RedmineCfg): Observable<RedmineActivity[]> {
    return this._sendRequest$(
      {
        url: `${cfg.host}/enumerations/time_entry_activities.json`,
      },
      cfg,
    ).pipe(map((res: RedmineActivityResult) => res?.time_entry_activities ?? []));
  }

  trackTime$({
    cfg,
    issueId,
    spentOn,
    hours,
    comment,
    activityId,
  }: {
    cfg: RedmineCfg;
    issueId: number;
    spentOn: string;
    hours: number;
    comment: string;
    activityId: number;
  }): Observable<any> {
    return this._sendRequest$(
      {
        method: 'POST',
        url: `${cfg.host}/time_entries.json`,
        data: {
          time_entry: {
            issue_id: issueId,
            spent_on: spentOn,
            hours,
            activity_id: activityId,
            comments: comment,
          },
        },
      },
      cfg,
    );
  }

  getTimeEntriesForCurrentUser$(issueId: number, cfg: RedmineCfg): Observable<number> {
    return this._sendRequest$(
      {
        url: `${cfg.host}/time_entries.json`,
        params: ParamsBuilder.create()
          .withLimit(100)
          .withParam('issue_id', String(issueId))
          .withParam('user_id', 'me')
          .build(),
      },
      cfg,
    ).pipe(
      map((res: RedmineTimeEntriesResult) => {
        return (res?.time_entries ?? []).reduce((sum, entry) => sum + entry.hours, 0);
      }),
    );
  }

  getById$(issueId: number, cfg: RedmineCfg): Observable<RedmineIssue> {
    return this._sendRequest$(
      {
        url: `${cfg.host}/issues/${issueId}.json`,
      },
      cfg,
    ).pipe(
      map(({ issue }) => Object.assign({ url: `${cfg.host}/issues/${issueId}` }, issue)),
    );
  }

  private _searchTextIssuesInProject$(
    query: string,
    cfg: RedmineCfg,
  ): Observable<SearchResultItem[]> {
    return this._sendRequest$(
      {
        url: `${cfg.host}${this._projectScopePath(cfg)}/search.json`,
        params: ParamsBuilder.create()
          .withLimit(100)
          .withQuery(query)
          .onlyIssues(true)
          .openIssues(true)
          .build(),
      },
      cfg,
    ).pipe(
      map((res: RedmineSearchResult) => {
        return res
          ? res.results.map((item: RedmineSearchResultItem) =>
              mapRedmineSearchResultItemToSearchResult(item),
            )
          : [];
      }),
    );
  }

  private _searchIssuesBySubjectInProject$(
    query: string,
    cfg: RedmineCfg,
  ): Observable<SearchResultItem[]> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return of([]);
    }

    return this._sendRequest$(
      {
        url: `${cfg.host}${this._projectScopePath(cfg)}/issues.json`,
        params: ParamsBuilder.create()
          .withLimit(100)
          .withState(RedmineIssueStatusOptions.open)
          .withSubjectContains(trimmedQuery)
          .build(),
      },
      cfg,
      { isSkipErrorHandling: true },
    ).pipe(
      map((res: RedmineIssueResult) =>
        (res?.issues ?? []).map((issue) => mapRedmineIssueToSearchResult(issue)),
      ),
    );
  }

  // Returns the project URL segment to prefix scoped endpoints with: `/projects/<id>` when a
  // project is configured, or '' when it is not. An empty segment makes requests hit Redmine's
  // instance-wide endpoints (`/search.json`, `/issues.json`), so a single connection can search
  // across the whole Redmine instead of a single project.
  private _projectScopePath(cfg: RedmineCfg): string {
    return cfg.projectId ? `/projects/${cfg.projectId}` : '';
  }

  private _sendRequest$(
    params: HttpRequest<string> | any,
    cfg: RedmineCfg,
    { isSkipErrorHandling = false }: { isSkipErrorHandling?: boolean } = {},
  ): Observable<any> {
    this._checkSettings(cfg);
    params.headers = {
      ...params.headers,
      'X-Redmine-API-Key': cfg.api_key,
    };

    // params.params = { ...params.params, key: cfg.api_key };

    const p: HttpRequest<any> | any = {
      ...params,
      method: params.method || 'GET',
    };

    const bodyArg = params.data ? [params.data] : [];

    const allArgs = [
      ...bodyArg,
      {
        headers: new HttpHeaders(p.headers),
        params: new HttpParams({ fromObject: p.params }),
        reportProgress: false,
        observe: 'response',
        responseType: params.responseType,
      },
    ];
    const req = new HttpRequest(p.method, p.url, ...allArgs);
    return this._http.request(req).pipe(
      // Filter out HttpEventType.Sent (type: 0) events to only process actual responses
      filter((res) => !(res === Object(res) && res.type === 0)),
      map((res: any) => (res && res.body ? res.body : res)),
      catchError((err) =>
        isSkipErrorHandling
          ? throwError(() => err)
          : handleIssueProviderHttpError$(REDMINE_TYPE, this._snackService, err),
      ),
    );
  }

  private _checkSettings(cfg: RedmineCfg): void {
    if (!this._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[REDMINE_TYPE],
        },
      });
      throwHandledError('Redmine: Not enough settings');
    }
  }

  // `projectId` is intentionally not required: when it is empty the service operates in
  // global mode and queries the whole Redmine instance instead of a single project.
  private _isValidSettings(cfg: RedmineCfg): boolean {
    return (
      !!cfg &&
      !!cfg.host &&
      cfg.host.length > 0 &&
      !!cfg.api_key &&
      cfg.api_key.length > 0
    );
  }
}

const queryHasNonAscii = (query: string): boolean => /[^\u0000-\u007F]/.test(query);

const getIssueId = (item: SearchResultItem): number | string | undefined => {
  return item.issueData?.id;
};

const mergeSearchResults = (
  ...resultGroups: SearchResultItem[][]
): SearchResultItem[] => {
  const seenIssueIds = new Set<number | string>();
  const mergedResults: SearchResultItem[] = [];

  for (const resultGroup of resultGroups) {
    for (const item of resultGroup) {
      const issueId = getIssueId(item);

      if (issueId !== undefined && issueId !== null) {
        if (seenIssueIds.has(issueId)) {
          continue;
        }

        seenIssueIds.add(issueId);
      }

      mergedResults.push(item);
    }
  }

  return mergedResults;
};

class ParamsBuilder {
  params: any = {};

  static create(): ParamsBuilder {
    return new ParamsBuilder();
  }

  withLimit(limit: number): ParamsBuilder {
    this.params['limit'] = limit;
    return this;
  }

  withState(state: string): ParamsBuilder {
    this.params['status_id'] = state;
    return this;
  }

  withScopeFrom(cfg: RedmineCfg): ParamsBuilder {
    if (!cfg.scope) return this;

    switch (cfg.scope) {
      case ScopeOptions.createdByMe:
        this.params['author_id'] = 'me';
        break;
      case ScopeOptions.assignedToMe:
        this.params['assigned_to_id'] = 'me';
        break;
    }

    return this;
  }

  withQuery(query: string): ParamsBuilder {
    this.params['q'] = query;
    return this;
  }

  withSubjectContains(query: string): ParamsBuilder {
    this.params['set_filter'] = '1';
    this.params['f[]'] = 'subject';
    this.params['op[subject]'] = '~';
    this.params['v[subject][]'] = query;
    return this;
  }

  onlyIssues(isOnlyIssues: boolean): ParamsBuilder {
    this.params['issues'] = isOnlyIssues ? '1' : '0';
    return this;
  }

  withParam(key: string, value: string): ParamsBuilder {
    this.params[key] = value;
    return this;
  }

  openIssues(isOpen: boolean): ParamsBuilder {
    this.params['open_issues'] = isOpen ? '1' : '0';
    return this;
  }

  build(): any {
    return this.params;
  }
}
