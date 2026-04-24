import { Injectable, inject } from '@angular/core';
import { SnackService } from '../../../../core/snack/snack.service';
import { HttpClient, HttpHeaders, HttpParams, HttpRequest } from '@angular/common/http';
import { GiteaCfg } from './gitea.model';
import { catchError, filter, map, switchMap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { T } from '../../../../t.const';
import { GITEA_TYPE, ISSUE_PROVIDER_HUMANIZED } from '../../issue.const';
import {
  GiteaIssue,
  GiteaIssueStateOptions,
  GiteaRepositoryReduced,
} from './gitea-issue.model';
import {
  isIssueFromProject,
  isIssueIncludedByLabels,
  mapGiteaIssueIdToIssueNumber,
  mapGiteaIssueToSearchResult,
  parseLabelList,
} from './gitea-issue-map.util';
import {
  GITEA_API_SUBPATH_REPO,
  GITEA_API_SUBPATH_USER,
  GITEA_API_SUFFIX,
  GITEA_API_VERSION,
  ScopeOptions,
} from './gitea.const';
import { SearchResultItem } from '../../issue.model';
import { GiteaUser } from './gitea-api-responses';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';

@Injectable({
  providedIn: 'root',
})
export class GiteaApiService {
  private _snackService = inject(SnackService);
  private _http = inject(HttpClient);

  searchIssueForRepo$(searchText: string, cfg: GiteaCfg): Observable<SearchResultItem[]> {
    const excludedLabelNames = parseLabelList(cfg.excludeLabels);
    return this.getCurrentRepositoryFor$(cfg).pipe(
      switchMap((repository: GiteaRepositoryReduced) => {
        return this._sendRequest$(
          {
            url: this._getIssueSearchUrlFor(cfg),
            params: ParamsBuilder.create()
              .withLimit(100)
              .withState(GiteaIssueStateOptions.open)
              .withScopeForSearchFrom(cfg, repository)
              .withFilterLabels(cfg)
              .withSearchTerm(searchText)
              .build(),
          },
          cfg,
        ).pipe(
          map((res: GiteaIssue[]) => {
            return res
              ? res
                  .filter((issue: GiteaIssue) => isIssueFromProject(issue, cfg))
                  .filter((issue: GiteaIssue) =>
                    isIssueIncludedByLabels(issue, excludedLabelNames),
                  )
                  .map((issue: GiteaIssue) => mapGiteaIssueIdToIssueNumber(issue))
                  .map((issue: GiteaIssue) => mapGiteaIssueToSearchResult(issue))
              : [];
          }),
        );
      }),
    );
  }

  private _getIssueSearchUrlFor(cfg: GiteaCfg): string {
    // see https://try.gitea.io/api/swagger#/issue
    return `${this._getBaseUrlFor(cfg)}/${GITEA_API_SUBPATH_REPO}/issues/search`;
  }

  getLast100IssuesFor$(cfg: GiteaCfg): Observable<GiteaIssue[]> {
    const excludedLabelNames = parseLabelList(cfg.excludeLabels);
    return this.getLoggedUserFor$(cfg).pipe(
      switchMap((user: GiteaUser) => {
        return this._sendRequest$(
          {
            url: this._getIssueUrlFor(cfg),
            params: ParamsBuilder.create()
              .withLimit(100)
              .withState(GiteaIssueStateOptions.open)
              .withScopeFrom(cfg, user)
              .withFilterLabels(cfg)
              .build(),
          },
          cfg,
        ).pipe(
          map((issues: GiteaIssue[]) => {
            return issues
              ? issues
                  .filter((issue: GiteaIssue) =>
                    isIssueIncludedByLabels(issue, excludedLabelNames),
                  )
                  .map((issue: GiteaIssue) => mapGiteaIssueIdToIssueNumber(issue))
              : [];
          }),
        );
      }),
    );
  }

  private _getIssueUrlFor(cfg: GiteaCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${GITEA_API_SUBPATH_REPO}/${
      cfg.repoFullname
    }/issues`;
  }

  getLoggedUserFor$(cfg: GiteaCfg): Observable<GiteaUser> {
    return this._sendRequest$(
      {
        url: this._getUserUrlFor(cfg),
        params: {},
      },
      cfg,
    ).pipe(
      map((user: GiteaUser) => {
        return user;
      }),
    );
  }

  private _getUserUrlFor(cfg: GiteaCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${GITEA_API_SUBPATH_USER}`;
  }

  getCurrentRepositoryFor$(cfg: GiteaCfg): Observable<GiteaRepositoryReduced> {
    return this._sendRequest$(
      {
        url: this._getRepositoryUrlFor(cfg),
        params: {},
      },
      cfg,
    ).pipe(
      map((repository: GiteaRepositoryReduced) => {
        return repository;
      }),
    );
  }

  private _getRepositoryUrlFor(cfg: GiteaCfg): string {
    return `${this._getBaseUrlFor(cfg)}/${GITEA_API_SUBPATH_REPO}/${cfg.repoFullname}`;
  }

  private _getBaseUrlFor(cfg: GiteaCfg): string {
    return `${cfg.host}/${GITEA_API_SUFFIX}/${GITEA_API_VERSION}`;
  }

  getById$(issueNumber: number, cfg: GiteaCfg): Observable<GiteaIssue> {
    return this._sendRequest$(
      {
        url: `${this._getIssueUrlFor(cfg)}/${issueNumber}`,
      },
      cfg,
    ).pipe(map((issue) => issue));
  }

  private _sendRequest$(
    params: HttpRequest<string> | any,
    cfg: GiteaCfg,
  ): Observable<any> {
    this._checkSettings(cfg);
    params.params = { ...params.params, access_token: cfg.token };
    const p: HttpRequest<any> | any = {
      ...params,
      method: params.method || 'GET',
      headers: {
        ...(params.headers ? params.headers : { accept: 'application/json' }),
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
        handleIssueProviderHttpError$(GITEA_TYPE, this._snackService, err),
      ),
    );
  }

  private _checkSettings(cfg: GiteaCfg): void {
    if (!this._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[GITEA_TYPE],
        },
      });
      throwHandledError('Gitea: Not enough settings');
    }
  }

  private _isValidSettings(cfg: GiteaCfg): boolean {
    return (
      !!cfg &&
      !!cfg.host &&
      cfg.host.length > 0 &&
      !!cfg.repoFullname &&
      cfg.repoFullname.length > 0
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

  withScopeFrom(cfg: GiteaCfg, user: GiteaUser): ParamsBuilder {
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

  withScopeForSearchFrom(
    cfg: GiteaCfg,
    repository: GiteaRepositoryReduced,
  ): ParamsBuilder {
    if (!cfg.scope) {
      return this;
    }

    // Seens to be the only way to "filter" for the current repo
    if (repository.id) this.params['priority_repo_id'] = repository.id;

    if (cfg.scope === ScopeOptions.createdByMe) {
      this.params['created'] = true;
    } else if (cfg.scope === ScopeOptions.assignedToMe) {
      this.params['assigned'] = true;
    }

    return this;
  }

  withFilterLabels(cfg: GiteaCfg): ParamsBuilder {
    const labels = parseLabelList(cfg.filterLabels);
    if (labels.length > 0) {
      this.params['labels'] = labels.join(',');
    }
    return this;
  }

  withSearchTerm(search: string): ParamsBuilder {
    this.params['q'] = search;
    return this;
  }

  build(): any {
    return this.params;
  }
}
