import { Injectable, inject } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
  HttpResponse,
} from '@angular/common/http';
import { EMPTY, Observable, ObservableInput, from, switchMap } from 'rxjs';
import { catchError, expand, map, reduce } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';
import { ISSUE_PROVIDER_HUMANIZED, BASECAMP_TYPE } from '../../issue.const';
import { IssueProviderActions } from '../../store/issue-provider.actions';
import { IssueProviderBasecamp } from '../../issue.model';
import { BasecampCfg } from './basecamp.model';
import {
  BasecampPaginatedResult,
  BasecampTodo,
  BasecampTodolist,
} from './basecamp-issue.model';
import {
  BasecampOAuthFlowService,
  BasecampOAuthTokens,
} from './basecamp-oauth-flow.service';

const BASECAMP_API_BASE = 'https://3.basecampapi.com';

type BasecampTodoStatusFilter = 'archived' | 'trashed';

interface BasecampTodoPage {
  items: BasecampTodo[];
  nextUrl?: string;
  totalCount?: number;
}

@Injectable({
  providedIn: 'root',
})
export class BasecampApiService {
  private readonly _http = inject(HttpClient);
  private readonly _snackService = inject(SnackService);
  private readonly _store = inject(Store);
  private readonly _basecampOAuthFlowService = inject(BasecampOAuthFlowService);

  private _withAuthRetry$<T>(
    cfg: BasecampCfg,
    makeRequest: (c: BasecampCfg) => Observable<T>,
  ): Observable<T> {
    return makeRequest(cfg).pipe(
      catchError((err) => {
        const status = (err as HttpErrorResponse)?.status;
        if (status === 401 && cfg.refreshToken) {
          return from(this._basecampOAuthFlowService.refresh(cfg.refreshToken)).pipe(
            switchMap((tokens) => {
              this._persistRefreshedTokens(cfg, tokens);
              return makeRequest({
                ...cfg,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiresAt: tokens.tokenExpiresAt,
              });
            }),
            catchError((retryErr) => this._handleError$<T>(retryErr)),
          );
        }
        return this._handleError$<T>(err);
      }),
    );
  }

  private _persistRefreshedTokens(cfg: BasecampCfg, tokens: BasecampOAuthTokens): void {
    const id = (cfg as Partial<IssueProviderBasecamp>).id;
    if (!id) {
      return;
    }
    this._store.dispatch(
      IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id,
          changes: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenExpiresAt: tokens.tokenExpiresAt,
          },
        },
      }),
    );
  }

  getTodolist$(todolistId: string, cfg: BasecampCfg): Observable<BasecampTodolist> {
    return this._withAuthRetry$(cfg, (c) =>
      this._http.get<BasecampTodolist>(
        // `.json` suffix forces a JSON response; without it Basecamp content-negotiates
        // and returns 406 for browser-like User-Agents (e.g. the Electron renderer).
        this._apiUrl(c, `/todolists/${encodeURIComponent(todolistId)}.json`),
        {
          headers: this._headers(c),
        },
      ),
    );
  }

  listTodos$(
    todolistId: string,
    cfg: BasecampCfg,
    {
      completed,
      status,
    }: {
      completed?: boolean;
      status?: BasecampTodoStatusFilter;
    } = {},
  ): Observable<BasecampPaginatedResult<BasecampTodo>> {
    return this._withAuthRetry$(cfg, (c) =>
      this._pageTodos$(
        this._apiUrl(c, `/todolists/${encodeURIComponent(todolistId)}/todos.json`),
        this._headers(c),
        this._todoListParams({ completed, status }),
      ).pipe(
        expand((page) =>
          page.nextUrl ? this._pageTodos$(page.nextUrl, this._headers(c)) : EMPTY,
        ),
        reduce(
          (acc, page) => ({
            items: acc.items.concat(page.items),
            totalCount: acc.totalCount ?? page.totalCount,
          }),
          { items: [] as BasecampTodo[], totalCount: undefined as number | undefined },
        ),
      ),
    );
  }

  getTodo$(todoId: string, cfg: BasecampCfg): Observable<BasecampTodo> {
    return this._withAuthRetry$(cfg, (c) =>
      this._http.get<BasecampTodo>(
        this._apiUrl(c, `/todos/${encodeURIComponent(todoId)}.json`),
        {
          headers: this._headers(c),
        },
      ),
    );
  }

  completeTodo$(todoId: string, cfg: BasecampCfg): Observable<void> {
    return this._withAuthRetry$(cfg, (c) =>
      this._http.post<void>(
        this._apiUrl(c, `/todos/${encodeURIComponent(todoId)}/completion.json`),
        {},
        { headers: this._headers(c) },
      ),
    );
  }

  uncompleteTodo$(todoId: string, cfg: BasecampCfg): Observable<void> {
    return this._withAuthRetry$(cfg, (c) =>
      this._http.delete<void>(
        this._apiUrl(c, `/todos/${encodeURIComponent(todoId)}/completion.json`),
        { headers: this._headers(c) },
      ),
    );
  }

  private _pageTodos$(
    url: string,
    headers: HttpHeaders,
    params?: HttpParams,
  ): Observable<BasecampTodoPage> {
    return this._http
      .get<BasecampTodo[]>(url, {
        headers,
        params,
        observe: 'response',
      })
      .pipe(
        map((response: HttpResponse<BasecampTodo[]>) => ({
          items: response.body ?? [],
          totalCount: parseTotalCount(response.headers.get('X-Total-Count')),
          nextUrl: getNextLink(response.headers.get('Link')),
        })),
      );
  }

  private _headers(cfg: BasecampCfg): HttpHeaders {
    this._checkSettings(cfg);
    return new HttpHeaders({
      Authorization: `Bearer ${cfg.accessToken}`,
      Accept: 'application/json',
    });
  }

  private _apiUrl(cfg: BasecampCfg, path: string): string {
    this._checkSettings(cfg);
    return `${BASECAMP_API_BASE}/${cfg.accountId}${path}`;
  }

  private _todoListParams({
    completed,
    status,
  }: {
    completed?: boolean;
    status?: BasecampTodoStatusFilter;
  }): HttpParams | undefined {
    let params = new HttpParams();
    let hasAny = false;

    if (completed) {
      params = params.set('completed', 'true');
      hasAny = true;
    }
    if (status) {
      params = params.set('status', status);
      hasAny = true;
    }

    return hasAny ? params : undefined;
  }

  private _checkSettings(cfg: BasecampCfg): void {
    if (!this._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[BASECAMP_TYPE],
        },
      });
      throwHandledError('Basecamp: Not enough settings');
    }
  }

  private _isValidSettings(cfg: BasecampCfg): boolean {
    return (
      !!cfg &&
      !!cfg.accessToken &&
      cfg.accessToken.length > 0 &&
      !!cfg.accountId &&
      cfg.accountId.length > 0
    );
  }

  private _handleError$<T>(error: unknown): ObservableInput<T> {
    return handleIssueProviderHttpError$<T>(
      BASECAMP_TYPE,
      this._snackService,
      error as HttpErrorResponse,
    );
  }
}

const parseTotalCount = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getNextLink = (linkHeader: string | null): string | undefined => {
  if (!linkHeader) {
    return undefined;
  }

  const nextPart = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/.test(part));

  if (!nextPart) {
    return undefined;
  }

  const match = nextPart.match(/<([^>]+)>/);
  return match?.[1];
};
