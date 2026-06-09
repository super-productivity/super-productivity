import { Injectable, inject } from '@angular/core';
import { SnackService } from '../../../../core/snack/snack.service';
import { HttpClient, HttpHeaders, HttpParams, HttpRequest } from '@angular/common/http';
import { ForgejoCfg } from './forgejo.model';
import { catchError, filter, map, switchMap } from 'rxjs/operators';
import { Observable, of } from 'rxjs';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { T } from '../../../../t.const';
import { FORGEJO_TYPE, ISSUE_PROVIDER_HUMANIZED } from '../../issue.const';
import {
  ForgejoIssue,
  ForgejoIssueStateOptions,
  ForgejoRepositoryReduced,
} from './forgejo-issue.model';
import {
  hasAllLabels,
  isIssueIncludedByLabels,
  mapForgejoIssueIdToIssueNumber,
  mapForgejoIssueToSearchResult,
  parseLabelList,
} from './forgejo-issue-map.util';
import {
  FORGEJO_API_SUBPATH_REPO,
  FORGEJO_API_SUBPATH_USER,
  FORGEJO_API_SUFFIX,
  FORGEJO_API_VERSION,
  ScopeOptions,
} from './forgejo.const';
import { SearchResultItem } from '../../issue.model';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';
import { IS_ELECTRON } from '../../../../app.constants';
import { ForgejoUser } from './forgejo-api-responses';

@Injectable({
  providedIn: 'root',
})
export class ForgejoApiService {
  private _snackService = inject(SnackService);
  private _http = inject(HttpClient);

  searchIssueForRepo$(searchText: string, cfg: ForgejoCfg): Observable<SearchResultItem[]> {
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
          map((res: ForgejoIssue[]) => {
            return res
              ? res
                  .filter((issue: ForgejoIssue) => hasAllLabels(issue, includedLabelNames))
                  .filter((issue: ForgejoIssue) =>
                    isIssueIncludedByLabels(issue, excludedLabelNames),
                  )
                  .filter((issue: ForgejoIssue) =>
                    this._issueMatchesSearchText(issue, normalizedSearchText),
                  )
                  .map((issue: ForgejoIssue) => mapForgejoIssueIdToIssueNumber(issue))
                  .map((issue: ForgejoIssue) => mapForgejoIssueToSearchResult(issue))
              : [];
          }),
        ),
      ),
    );
  }

  getLast100IssuesFor$(cfg: ForgejoCfg): Observable<ForgejoIssue[]> {
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
          map((issues: ForgejoIssue[]) => {
            return issues
              ? issues
                  .filter((issue: ForgejoIssue) => hasAllLabels(issue, includedLabelNames))
                  .filter((issue: ForgejoIssue) =>
                    isIssueIncludedByLabels(issue, excludedLabelNames),
                  )
                  .map((issue: ForgejoIssue) => mapForgejoIssueIdToIssueNumber(issue))
              : [];
          }),
        ),
      ),
    );
  }

  private _getIssueUrlFor(cfg: ForgejoCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${FORGEJO_API_SUBPATH_REPO}/${
      cfg.repoFullname
    }/issues`;
  }

  getLoggedUserFor$(cfg: ForgejoCfg): Observable<ForgejoUser> {
    return this._sendRequest$(
      {
        url: this._getUserUrlFor(cfg),
        params: {},
      },
      cfg,
    ).pipe(
      map((user: ForgejoUser) => {
        return user;
      }),
    );
  }

  private _getUserUrlFor(cfg: ForgejoCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${FORGEJO_API_SUBPATH_USER}`;
  }

  private _getRepoIssueListParams$(cfg: ForgejoCfg): Observable<any> {
    const paramsBuilder = ParamsBuilder.create()
      .withLimit(100)
      .withState(ForgejoIssueStateOptions.open)
      .withFilterLabels(cfg);

    if (cfg.scope === ScopeOptions.createdByMe || cfg.scope === ScopeOptions.assignedToMe) {
      return this.getLoggedUserFor$(cfg).pipe(
        map((user: ForgejoUser) => paramsBuilder.withScopeFrom(cfg, user).build()),
      );
    }

    return of(paramsBuilder.build());
  }

  private _issueMatchesSearchText(issue: ForgejoIssue, normalizedSearchText: string): boolean {
    if (!normalizedSearchText) {
      return true;
    }

    return (
      String(issue.number).includes(normalizedSearchText) ||
      issue.title.toLowerCase().includes(normalizedSearchText) ||
      (issue.body ?? '').toLowerCase().includes(normalizedSearchText)
    );
  }

  getCurrentRepositoryFor$(cfg: ForgejoCfg): Observable<ForgejoRepositoryReduced> {
    return this._sendRequest$(
      {
        url: this._getRepositoryUrlFor(cfg),
        params: {},
      },
      cfg,
    ).pipe(
      map((repository: ForgejoRepositoryReduced) => {
        return repository;
      }),
    );
  }

  private _getRepositoryUrlFor(cfg: ForgejoCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${FORGEJO_API_SUBPATH_REPO}/${cfg.repoFullname}`;
  }

  private _getBaseUrlFor(cfg: ForgejoCfg): string {
    return `${cfg.host?.replace(/\/$/, '')}/${FORGEJO_API_SUFFIX}/${FORGEJO_API_VERSION}`;
  }

  getById$(issueNumber: number, cfg: ForgejoCfg): Observable<ForgejoIssue> {
    return this._sendRequest$(
      {
        url: `${this._getIssueUrlFor(cfg)}/${issueNumber}`,
      },
      cfg,
    ).pipe(map((issue) => issue));
  }

  private _sendRequest$(
    params: HttpRequest<string> | any,
    cfg: ForgejoCfg,
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
        ...(IS_ELECTRON ? { 'X-Super-Productivity-Issue-Provider': 'forgejo' } : {}),
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
        handleIssueProviderHttpError$(FORGEJO_TYPE, this._snackService, err),
      ),
    );
  }

  private _checkSettings(cfg: ForgejoCfg): void {
    if (!this._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[FORGEJO_TYPE],
        },
      });
      throwHandledError('Forgejo: Not enough settings');
    }
  }

  private _isValidSettings(cfg: ForgejoCfg): boolean {
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

  withScopeFrom(cfg: ForgejoCfg, user: ForgejoUser): ParamsBuilder {
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

  withFilterLabels(cfg: ForgejoCfg): ParamsBuilder {
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
