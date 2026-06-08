import { Injectable, inject } from '@angular/core';
import { SnackService } from '../../../../core/snack/snack.service';
import { HttpClient, HttpHeaders, HttpParams, HttpRequest } from '@angular/common/http';
import { CodebergCfg } from './codeberg.model';
import { catchError, filter, map, switchMap } from 'rxjs/operators';
import { Observable, of } from 'rxjs';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { T } from '../../../../t.const';
import { CODEBERG_TYPE, ISSUE_PROVIDER_HUMANIZED } from '../../issue.const';
import {
  CodebergIssue,
  CodebergIssueStateOptions,
  CodebergRepositoryReduced,
} from './codeberg-issue.model';
import {
  hasAllLabels,
  isIssueIncludedByLabels,
  mapCodebergIssueIdToIssueNumber,
  mapCodebergIssueToSearchResult,
  parseLabelList,
} from './codeberg-issue-map.util';
import {
  CODEBERG_API_SUBPATH_REPO,
  CODEBERG_API_SUBPATH_USER,
  CODEBERG_API_SUFFIX,
  CODEBERG_API_VERSION,
  ScopeOptions,
} from './codeberg.const';
import { SearchResultItem } from '../../issue.model';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';
import { IS_ELECTRON } from '../../../../app.constants';
import { CodebergUser } from './codeberg-api-responses';

@Injectable({
  providedIn: 'root',
})
export class CodebergApiService {
  private _snackService = inject(SnackService);
  private _http = inject(HttpClient);

  searchIssueForRepo$(searchText: string, cfg: CodebergCfg): Observable<SearchResultItem[]> {
    const includedLabelNames = parseLabelList(cfg.filterLabels);
    const excludedLabelNames = parseLabelList(cfg.excludeLabels);
    const normalizedSearchText = searchText.trim().toLowerCase();

    return this._getRepoIssueListParams$(cfg).pipe(
      switchMap((issueParams) =>
        this._sendRequest$(
          {
            url: this._getIssueUrlFor(cfg),
            params: issueParams,
          },
          cfg,
        ).pipe(
          map((res: CodebergIssue[]) => {
            return res
              ? res
                  .filter((issue: CodebergIssue) => hasAllLabels(issue, includedLabelNames))
                  .filter((issue: CodebergIssue) =>
                    isIssueIncludedByLabels(issue, excludedLabelNames),
                  )
                  .filter((issue: CodebergIssue) =>
                    this._issueMatchesSearchText(issue, normalizedSearchText),
                  )
                  .map((issue: CodebergIssue) => mapCodebergIssueIdToIssueNumber(issue))
                  .map((issue: CodebergIssue) => mapCodebergIssueToSearchResult(issue))
              : [];
          }),
        ),
      ),
    );
  }

  getLast100IssuesFor$(cfg: CodebergCfg): Observable<CodebergIssue[]> {
    const includedLabelNames = parseLabelList(cfg.filterLabels);
    const excludedLabelNames = parseLabelList(cfg.excludeLabels);

    return this._getRepoIssueListParams$(cfg).pipe(
      switchMap((issueParams) =>
        this._sendRequest$(
          {
            url: this._getIssueUrlFor(cfg),
            params: issueParams,
          },
          cfg,
        ).pipe(
          map((issues: CodebergIssue[]) => {
            return issues
              ? issues
                  .filter((issue: CodebergIssue) => hasAllLabels(issue, includedLabelNames))
                  .filter((issue: CodebergIssue) =>
                    isIssueIncludedByLabels(issue, excludedLabelNames),
                  )
                  .map((issue: CodebergIssue) => mapCodebergIssueIdToIssueNumber(issue))
              : [];
          }),
        ),
      ),
    );
  }

  private _getIssueUrlFor(cfg: CodebergCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${CODEBERG_API_SUBPATH_REPO}/${
      cfg.repoFullname
    }/issues`;
  }

  getLoggedUserFor$(cfg: CodebergCfg): Observable<CodebergUser> {
    return this._sendRequest$(
      {
        url: this._getUserUrlFor(cfg),
        params: {},
      },
      cfg,
    ).pipe(
      map((user: CodebergUser) => {
        return user;
      }),
    );
  }

  private _getUserUrlFor(cfg: CodebergCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${CODEBERG_API_SUBPATH_USER}`;
  }

  private _getRepoIssueListParams$(cfg: CodebergCfg): Observable<any> {
    const paramsBuilder = ParamsBuilder.create()
      .withLimit(100)
      .withState(CodebergIssueStateOptions.open)
      .withFilterLabels(cfg);

    if (cfg.scope === ScopeOptions.createdByMe || cfg.scope === ScopeOptions.assignedToMe) {
      return this.getLoggedUserFor$(cfg).pipe(
        map((user: CodebergUser) => paramsBuilder.withScopeFrom(cfg, user).build()),
      );
    }

    return of(paramsBuilder.build());
  }

  private _issueMatchesSearchText(issue: CodebergIssue, normalizedSearchText: string): boolean {
    if (!normalizedSearchText) {
      return true;
    }

    return (
      String(issue.number).includes(normalizedSearchText) ||
      issue.title.toLowerCase().includes(normalizedSearchText) ||
      (issue.body ?? '').toLowerCase().includes(normalizedSearchText)
    );
  }

  getCurrentRepositoryFor$(cfg: CodebergCfg): Observable<CodebergRepositoryReduced> {
    return this._sendRequest$(
      {
        url: this._getRepositoryUrlFor(cfg),
        params: {},
      },
      cfg,
    ).pipe(
      map((repository: CodebergRepositoryReduced) => {
        return repository;
      }),
    );
  }

  private _getRepositoryUrlFor(cfg: CodebergCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${CODEBERG_API_SUBPATH_REPO}/${cfg.repoFullname}`;
  }

  private _getBaseUrlFor(cfg: CodebergCfg): string {
    return `${cfg.host?.replace(/\/$/, '')}/${CODEBERG_API_SUFFIX}/${CODEBERG_API_VERSION}`;
  }

  getById$(issueNumber: number, cfg: CodebergCfg): Observable<CodebergIssue> {
    return this._sendRequest$(
      {
        url: `${this._getIssueUrlFor(cfg)}/${issueNumber}`,
      },
      cfg,
    ).pipe(map((issue) => issue));
  }

  private _sendRequest$(
    params: HttpRequest<string> | any,
    cfg: CodebergCfg,
  ): Observable<any> {
    this._checkSettings(cfg);
    // Use the query-param token style here to match the existing Gitea integration.
    // It avoids browser/Electron CORS preflight failures on Forgejo/Gitea instances
    // that do not allow the Authorization header from localhost during provider setup.
    params.params = { ...params.params, access_token: cfg.token };
    const p: HttpRequest<any> | any = {
      ...params,
      method: params.method || 'GET',
      headers: {
        ...(params.headers ? params.headers : { accept: 'application/json' }),
        ...(IS_ELECTRON ? { 'X-Super-Productivity-Issue-Provider': 'codeberg' } : {}),
      },
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
        handleIssueProviderHttpError$(CODEBERG_TYPE, this._snackService, err),
      ),
    );
  }

  private _checkSettings(cfg: CodebergCfg): void {
    if (!this._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[CODEBERG_TYPE],
        },
      });
      throwHandledError('Codeberg: Not enough settings');
    }
  }

  private _isValidSettings(cfg: CodebergCfg): boolean {
    return (
      !!cfg &&
      !!cfg.host &&
      cfg.host.length > 0 &&
      !!cfg.repoFullname &&
      cfg.repoFullname.length > 0 &&
      !!cfg.token &&
      cfg.token.length > 0
    );
  }
}

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
    this.params['state'] = state;
    return this;
  }

  withScopeFrom(cfg: CodebergCfg, user: CodebergUser): ParamsBuilder {
    if (!cfg.scope) {
      return this;
    }

    if (cfg.scope === ScopeOptions.createdByMe) {
      this.params['created_by'] = user.username;
    } else if (cfg.scope === ScopeOptions.assignedToMe) {
      this.params['assigned_by'] = user.username;
    }

    return this;
  }

  withFilterLabels(cfg: CodebergCfg): ParamsBuilder {
    const labels = parseLabelList(cfg.filterLabels);
    if (labels.length > 0) {
      this.params['labels'] = labels.join(',');
    }
    return this;
  }

  build(): any {
    return this.params;
  }
}
