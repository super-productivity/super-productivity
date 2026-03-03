import { Injectable, inject } from '@angular/core';
import { GithubCfg } from './github.model';
import { SnackService } from '../../../../core/snack/snack.service';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
  HttpRequest,
  HttpParameterCodec,
} from '@angular/common/http';
import { GITHUB_API_BASE_URL } from './github.const';
import { Observable, ObservableInput, of, throwError } from 'rxjs';
import { GithubIssueSearchResult } from './github-api-responses';
import { catchError, filter, map, switchMap } from 'rxjs/operators';
import {
  mapGithubGraphQLSearchResult,
  mapGithubIssue,
  mapGithubIssueToSearchResult,
} from './github-issue-map.util';
import { GithubComment, GithubIssue, GithubIssueReduced } from './github-issue.model';
import { SearchResultItem } from '../../issue.model';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { T } from '../../../../t.const';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { GITHUB_TYPE, ISSUE_PROVIDER_HUMANIZED } from '../../issue.const';
import { IssueLog } from '../../../../core/log';

const BASE = GITHUB_API_BASE_URL;

// Custom encoder to ensure parentheses are encoded for GitHub API
class CustomHttpParamEncoder implements HttpParameterCodec {
  encodeKey(key: string): string {
    return encodeURIComponent(key);
  }

  encodeValue(value: string): string {
    // Encode all special characters including parentheses
    return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  decodeKey(key: string): string {
    return decodeURIComponent(key);
  }

  decodeValue(value: string): string {
    return decodeURIComponent(value);
  }
}

@Injectable({
  providedIn: 'root',
})
export class GithubApiService {
  private _snackService = inject(SnackService);
  private _http = inject(HttpClient);

  getById$(
    issueId: number,
    cfg: GithubCfg,
    isGetComments: boolean = true,
  ): Observable<GithubIssue> {
    return this._sendRequest$(
      {
        url: `${BASE}repos/${cfg.repo}/issues/${issueId}`,
      },
      cfg,
    ).pipe(
      switchMap((issue) =>
        isGetComments
          ? this.getCommentListForIssue$(issueId, cfg).pipe(
              map((comments) => ({ ...issue, comments })),
            )
          : of(issue),
      ),
    );
  }

  getCommentListForIssue$(issueId: number, cfg: GithubCfg): Observable<GithubComment[]> {
    return this._sendRequest$(
      {
        url: `${BASE}repos/${cfg.repo}/issues/${issueId}/comments`,
      },
      cfg,
    ).pipe();
  }

  searchIssueForRepo$(
    searchText: string,
    cfg: GithubCfg,
    isSearchAllGithub: boolean = false,
  ): Observable<SearchResultItem<'GITHUB'>[]> {
    return this.searchIssueForRepoNoMap$(searchText, cfg, isSearchAllGithub).pipe(
      map((issues: GithubIssueReduced[]) =>
        issues.map((issue) => mapGithubIssueToSearchResult(issue)),
      ),
    );
  }

  searchIssueForRepoNoMap$(
    searchText: string,
    cfg: GithubCfg,
    isSearchAllGithub: boolean = false,
  ): Observable<GithubIssueReduced[]> {
    // Fine-grained PATs require is:issue in the query
    const queryWithType =
      searchText.includes('is:issue') || searchText.includes('is:pull-request')
        ? searchText
        : `is:issue ${searchText}`;

    // Build the full query string
    const fullQuery = isSearchAllGithub
      ? queryWithType
      : `${queryWithType} repo:${cfg.repo || ''}`;

    // Use HttpParams to properly handle encoding, but we need custom encoding for parentheses
    const params = new HttpParams({ encoder: new CustomHttpParamEncoder() }).set(
      'q',
      fullQuery,
    );

    return this._sendRequest$(
      {
        url: `${BASE}search/issues`,
        params: params,
      },
      cfg,
    ).pipe(
      map((res: GithubIssueSearchResult) => {
        return res && res.items ? res.items.map(mapGithubIssue) : [];
      }),
    );
  }

  createIssue$(title: string, cfg: GithubCfg): Observable<GithubIssue> {
    return this._sendRequest$(
      {
        url: `${BASE}repos/${cfg.repo}/issues`,
        method: 'POST',
        data: { title },
      },
      cfg,
    ).pipe(map((issue) => mapGithubIssue(issue)));
  }

  updateIssue$(
    issueId: number,
    changes: { state?: string; title?: string; body?: string },
    cfg: GithubCfg,
  ): Observable<GithubIssue> {
    return this._sendRequest$(
      {
        url: `${BASE}repos/${cfg.repo}/issues/${issueId}`,
        method: 'PATCH',
        data: changes,
      },
      cfg,
    ).pipe(map((issue) => mapGithubIssue(issue)));
  }

  graphQl$(cfg: GithubCfg, query: string): Observable<unknown> {
    return this._sendRequest$(
      {
        url: `${BASE}graphql`,
        method: 'POST',
        data: { query },
      },
      cfg,
    );
  }

  getImportToBacklogIssuesFromGraphQL(cfg: GithubCfg): Observable<GithubIssueReduced[]> {
    const split = cfg.repo?.split('/') || [];
    const owner = encodeURIComponent(split[0] || '');
    const repo = encodeURIComponent(split[1] || '');
    const assigneeFilter = cfg.backlogQuery
      ? `, assignee: "${cfg.filterUsernameForIssueUpdates}"`
      : '';

    return this.graphQl$(
      cfg,
      `
query Issues {
  repository(owner: "${owner}", name: "${repo}") {
    issues(last: 100, filterBy: {states: OPEN${assigneeFilter}}, orderBy: {field: UPDATED_AT, direction:DESC}) {
      edges {
        node {
          number
          title
          state
          updatedAt
        }
      }
    }
  }
}
    `,
    ).pipe(
      map((res) => {
        if ((res as any)?.errors?.length) {
          this._snackService.open({
            type: 'ERROR',
            msg: (res as any)?.errors[0].message,
          });
          return [];
        }

        try {
          return mapGithubGraphQLSearchResult(res);
        } catch (e) {
          IssueLog.err(e);
          this._snackService.open({
            type: 'ERROR',
            msg: T.F.GITHUB.S.CONFIG_ERROR,
          });
          return [];
        }
      }),
    );
  }

  private _checkSettings(cfg: GithubCfg): void {
    if (!this._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[GITHUB_TYPE],
        },
      });
      throwHandledError('Github: Not enough settings');
    }
  }

  private _isValidSettings(cfg: GithubCfg): boolean {
    return !!cfg && !!cfg.repo && cfg.repo.length > 0;
  }

  private _sendRequest$(
    params: HttpRequest<string> | any,
    cfg: GithubCfg,
  ): Observable<any> {
    this._checkSettings(cfg);

    const p: HttpRequest<any> | any = {
      ...params,
      method: params.method || 'GET',
      headers: {
        ...(cfg.token ? { Authorization: 'token ' + cfg.token } : {}),
        ...(params.headers ? params.headers : {}),
      },
    };

    const bodyArg = params.data ? [params.data] : [];

    // Handle params - if it's already an HttpParams object, use it directly
    const httpParams =
      params.params instanceof HttpParams
        ? params.params
        : new HttpParams({ fromObject: p.params || {} });

    const allArgs = [
      ...bodyArg,
      {
        headers: new HttpHeaders(p.headers),
        params: httpParams,
        reportProgress: false,
        observe: 'response',
        responseType: params.responseType,
      },
    ];
    const req = new HttpRequest(p.method, p.url, ...allArgs);
    return this._http.request(req).pipe(
      // Filter out HttpEventType.Sent (type: 0) events to only process actual responses
      filter((res) => !(res === Object(res) && res.type === 0)),
      map((res) =>
        res && (res as { body?: unknown }).body ? (res as { body: unknown }).body : res,
      ),
      catchError(this._handleRequestError$.bind(this)),
    );
  }

  private _handleRequestError$(
    error: HttpErrorResponse,
    caught: Observable<unknown>,
  ): ObservableInput<unknown> {
    if (error.error instanceof ErrorEvent) {
      // A client-side or network error occurred. Handle it accordingly.
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NETWORK,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[GITHUB_TYPE],
        },
      });
    } else if (error.error && error.error.message) {
      this._snackService.open({
        type: 'ERROR',
        msg: ISSUE_PROVIDER_HUMANIZED[GITHUB_TYPE] + ': ' + error.error.message,
      });
    } else {
      // The backend returned an unsuccessful response code.
      this._snackService.open({
        type: 'ERROR',
        translateParams: {
          errorMsg:
            (error.error && (error.error.name || error.error.statusText)) ||
            error.toString(),
          statusCode: error.status,
        },
        msg: T.F.GITHUB.S.ERR_UNKNOWN,
      });
    }
    if (error && error.message) {
      return throwError({ [HANDLED_ERROR_PROP_STR]: 'Github: ' + error.message });
    }

    return throwError({ [HANDLED_ERROR_PROP_STR]: 'Github: Api request failed.' });
  }
}
