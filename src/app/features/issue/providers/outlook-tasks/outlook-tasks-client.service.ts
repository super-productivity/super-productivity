import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { from, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { OutlookTasksCfg } from './outlook-tasks.model';
import {
  OutlookTasksIssue,
  OutlookTaskImportance,
  OutlookTaskStatus,
} from './outlook-tasks-issue.model';
import { OUTLOOK_TASKS_TYPE } from '../../issue.const';
import { SearchResultItem } from '../../issue.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { IssueLog } from '../../../../core/log';
import { IS_ELECTRON } from '../../../../app.constants';
import { IssueProviderActions } from '../../store/issue-provider.actions';
import { addOAuthState } from '../../../../imex/sync/oauth-state.util';
import { T } from '../../../../t.const';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_REFRESH_SKEW_MS = 60_000;

const VALID_STATUSES = new Set<string>(Object.values(OutlookTaskStatus));
const VALID_IMPORTANCES = new Set<string>(Object.values(OutlookTaskImportance));
const VALID_CONTENT_TYPES = new Set(['text', 'html']);

interface GraphTaskListResponse {
  value: Array<{
    id: string;
    displayName: string;
    isOwner: boolean;
    isShared: boolean;
  }>;
}

interface GraphTaskItem {
  id: string;
  title: string;
  status: string;
  importance: string;
  body?: {
    content: string;
    contentType: string;
  };
  completedDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  dueDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  startDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  isReminderOn: boolean;
  lastModifiedDateTime: string;
  createdDateTime: string;
  categories?: string[];
  hasAttachments: boolean;
}

interface GraphTasksResponse {
  value: GraphTaskItem[];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  '@odata.nextLink'?: string;
}

type GraphTaskResponse = GraphTaskItem;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

@Injectable({
  providedIn: 'root',
})
export class OutlookTasksClientService {
  private readonly _snackService = inject(SnackService);
  private readonly _store = inject(Store);
  private _tokenRefreshInFlightPromise: Promise<string> | null = null;
  // Cache the latest token so paginated / chained calls within the same cfg
  // lifecycle don't re-trigger refresh after the in-flight promise settles.
  private _cachedToken: { accessToken: string; expiresAt: number } | null = null;

  getAuthUrl(cfg: OutlookTasksCfg): string {
    const tenant = cfg.tenantId || 'common';
    const redirectUri = this._getRedirectUri();
    const scope =
      'offline_access https://graph.microsoft.com/Tasks.ReadWrite https://graph.microsoft.com/User.Read';

    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    addOAuthState('outlook-tasks', state);

    return (
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(cfg.clientId || '')}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}` +
      '&response_mode=query' +
      '&prompt=consent'
    );
  }

  async exchangeAuthCode(
    cfg: OutlookTasksCfg,
    authCode: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> {
    const tenant = cfg.tenantId || 'common';
    const redirectUri = this._getRedirectUri();

    const body = new URLSearchParams({
      client_id: cfg.clientId || '',
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      scope:
        'offline_access https://graph.microsoft.com/Tasks.ReadWrite https://graph.microsoft.com/User.Read',
    });

    const response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      IssueLog.err('Outlook Tasks token exchange failed', errBody);
      throw new Error('Token exchange failed: ' + response.status);
    }

    const data = (await response.json()) as TokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      // eslint-disable-next-line no-mixed-operators
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async getTaskLists(cfg: OutlookTasksCfg): Promise<Array<{ id: string; name: string }>> {
    const data = await this._requestJson<GraphTaskListResponse>(cfg, '/me/todo/lists');
    return data.value.map((list) => ({ id: list.id, name: list.displayName }));
  }

  getOpenTasks$(cfg: OutlookTasksCfg): Observable<OutlookTasksIssue[]> {
    return from(this.getOpenTasks(cfg)).pipe(
      catchError((err) =>
        throwError(() => ({ [HANDLED_ERROR_PROP_STR]: 'Outlook Tasks: ' + err })),
      ),
    );
  }

  /**
   * Fetch open tasks directly using the provided cfg (bypasses store).
   * Use this for testConnection before the provider is persisted.
   */
  async getOpenTasks(cfg: OutlookTasksCfg): Promise<OutlookTasksIssue[]> {
    return this._getOpenTasks(cfg);
  }

  searchOpenTasks$(text: string, cfg: OutlookTasksCfg): Observable<SearchResultItem[]> {
    return from(
      this._getOpenTasks(cfg).then((tasks) =>
        tasks
          .filter((t) => t.title.toLowerCase().includes(text.toLowerCase()))
          .map((t) => ({
            title: t.title,
            issueType: OUTLOOK_TASKS_TYPE,
            issueData: t,
          })),
      ),
    ).pipe(
      catchError((err) =>
        throwError(() => ({ [HANDLED_ERROR_PROP_STR]: 'Outlook Tasks: ' + err })),
      ),
    );
  }

  getById$(id: string | number, cfg: OutlookTasksCfg): Observable<OutlookTasksIssue> {
    return from(this._getTaskById(cfg, id.toString())).pipe(
      catchError((err) =>
        throwError(() => ({ [HANDLED_ERROR_PROP_STR]: 'Outlook Tasks: ' + err })),
      ),
    );
  }

  updateTask$(
    cfg: OutlookTasksCfg,
    taskId: string,
    updates: {
      title?: string;
      status?: string;
      body?: string;
    },
  ): Observable<void> {
    return from(this._updateTask(cfg, taskId, updates)).pipe(
      catchError((err) =>
        throwError(() => ({ [HANDLED_ERROR_PROP_STR]: 'Outlook Tasks: ' + err })),
      ),
    );
  }

  // ---- private helpers ----

  private _getRedirectUri(): string {
    return IS_ELECTRON
      ? 'superproductivity://oauth-callback/outlook-tasks'
      : 'https://login.microsoftonline.com/common/oauth2/nativeclient';
  }

  private async _getTaskListId(cfg: OutlookTasksCfg): Promise<string> {
    if (cfg.taskListId) {
      return cfg.taskListId;
    }
    const lists = await this.getTaskLists(cfg);
    if (lists.length === 0) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.OUTLOOK_TASKS.S.NO_TASK_LISTS,
      });
      throw new Error('No Outlook task lists found');
    }
    return lists[0].id;
  }

  private async _getOpenTasks(cfg: OutlookTasksCfg): Promise<OutlookTasksIssue[]> {
    const listId = await this._getTaskListId(cfg);
    const tasks: OutlookTasksIssue[] = [];
    let nextUrl: string | undefined =
      `/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'&$top=100`;

    while (nextUrl) {
      const data = await this._requestJson<GraphTasksResponse>(cfg, nextUrl);
      for (const t of data.value) {
        tasks.push(this._mapTask(t));
      }
      // Pass the full @odata.nextLink URL directly — _request handles absolute URLs.
      nextUrl = data['@odata.nextLink'] || undefined;
    }

    return tasks;
  }

  private async _getTaskById(
    cfg: OutlookTasksCfg,
    taskId: string,
  ): Promise<OutlookTasksIssue> {
    const listId = await this._getTaskListId(cfg);
    const data = await this._requestJson<GraphTaskResponse>(
      cfg,
      `/me/todo/lists/${listId}/tasks/${taskId}`,
    );
    return this._mapTask(data);
  }

  private async _updateTask(
    cfg: OutlookTasksCfg,
    taskId: string,
    updates: { title?: string; status?: string; body?: string },
  ): Promise<void> {
    const listId = await this._getTaskListId(cfg);
    const patchBody: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      patchBody.title = updates.title;
    }
    if (updates.status !== undefined) {
      patchBody.status = updates.status;
    }
    if (updates.body !== undefined) {
      patchBody.body = {
        content: updates.body,
        contentType: 'text',
      };
    }

    await this._request(cfg, {
      method: 'PATCH',
      path: `/me/todo/lists/${listId}/tasks/${taskId}`,
      body: JSON.stringify(patchBody),
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
      },
    });
  }

  private _mapTask(t: GraphTaskResponse): OutlookTasksIssue {
    return {
      id: t.id,
      title: t.title,
      status: VALID_STATUSES.has(t.status)
        ? (t.status as OutlookTaskStatus)
        : OutlookTaskStatus.NOT_STARTED,
      importance: VALID_IMPORTANCES.has(t.importance)
        ? (t.importance as OutlookTaskImportance)
        : OutlookTaskImportance.NORMAL,
      body: t.body
        ? {
            content: t.body.content,
            contentType: VALID_CONTENT_TYPES.has(t.body.contentType)
              ? (t.body.contentType as 'text' | 'html')
              : 'text',
          }
        : undefined,
      completedDateTime: t.completedDateTime,
      dueDateTime: t.dueDateTime,
      startDateTime: t.startDateTime,
      isReminderOn: t.isReminderOn,
      lastModifiedDateTime: t.lastModifiedDateTime,
      createdDateTime: t.createdDateTime,
      categories: t.categories,
      hasAttachments: t.hasAttachments,
    };
  }

  private async _refreshAccessTokenIfNeeded(cfg: OutlookTasksCfg): Promise<string> {
    // Prefer the in-memory cached token over the (possibly stale) cfg snapshot.
    const effectiveToken = this._cachedToken?.accessToken || cfg.accessToken;
    const effectiveExpiresAt = this._cachedToken?.expiresAt || cfg.tokenExpiresAt || 0;

    if (effectiveToken && Date.now() < effectiveExpiresAt - TOKEN_REFRESH_SKEW_MS) {
      return effectiveToken;
    }
    if (!cfg.refreshToken) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.OUTLOOK_TASKS.S.AUTH_EXPIRED,
      });
      throw new Error('No refresh token');
    }

    if (this._tokenRefreshInFlightPromise) {
      return this._tokenRefreshInFlightPromise;
    }

    this._tokenRefreshInFlightPromise = (async () => {
      try {
        const tenant = cfg.tenantId || 'common';
        const body = new URLSearchParams({
          client_id: cfg.clientId || '',
          grant_type: 'refresh_token',
          refresh_token: cfg.refreshToken || '',
          scope:
            'offline_access https://graph.microsoft.com/Tasks.ReadWrite https://graph.microsoft.com/User.Read',
        });

        const response = await fetch(
          `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
          },
        );

        if (!response.ok) {
          IssueLog.err('Outlook Tasks token refresh failed', response.status);
          throw new Error('Token refresh failed');
        }

        const data = (await response.json()) as TokenResponse;
        const newAccessToken = data.access_token;
        const newRefreshToken = data.refresh_token || cfg.refreshToken;
        // eslint-disable-next-line no-mixed-operators
        const newExpiresAt = Date.now() + data.expires_in * 1000;

        // Cache in memory so subsequent calls with the same stale cfg use the
        // refreshed token immediately without waiting for the store update.
        this._cachedToken = { accessToken: newAccessToken, expiresAt: newExpiresAt };

        // Persist refreshed tokens so subsequent requests don't re-trigger refresh.
        // Azure AD rotates refresh tokens, so failing to persist would eventually
        // cause permanent auth failure.
        if (cfg.issueProviderId) {
          this._store.dispatch(
            IssueProviderActions.updateIssueProvider({
              issueProvider: {
                id: cfg.issueProviderId,
                changes: {
                  accessToken: newAccessToken,
                  refreshToken: newRefreshToken,
                  tokenExpiresAt: newExpiresAt,
                },
              },
            }),
          );
        }

        return newAccessToken;
      } finally {
        this._tokenRefreshInFlightPromise = null;
      }
    })();

    return this._tokenRefreshInFlightPromise;
  }

  private async _request(
    cfg: OutlookTasksCfg,
    options: {
      method: string;
      path: string;
      body?: string;
      headers?: Record<string, string>;
    },
  ): Promise<Response> {
    const accessToken = await this._refreshAccessTokenIfNeeded(cfg);
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', 'application/json');

    const fullUrl = options.path.startsWith('http')
      ? options.path
      : `${GRAPH_API_BASE}${options.path}`;

    let response = await fetch(fullUrl, {
      method: options.method,
      headers,
      body: options.body,
    });

    // On 401, force-refresh the token and retry once.
    if (response.status === 401) {
      this._cachedToken = null;
      try {
        const newToken = await this._refreshAccessTokenIfNeeded(cfg);
        headers.set('Authorization', `Bearer ${newToken}`);
        response = await fetch(fullUrl, {
          method: options.method,
          headers,
          body: options.body,
        });
      } catch {
        // Refresh itself failed — fall through to error handling below.
      }
    }

    if (!response.ok) {
      const errBody = await response.text();
      IssueLog.err('Outlook Tasks API error', {
        status: response.status,
        body: errBody,
      });
      if (response.status === 401) {
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.OUTLOOK_TASKS.S.AUTH_EXPIRED,
        });
      }
      throw new Error(`Outlook Tasks API ${response.status}: ${errBody}`);
    }

    return response;
  }

  private async _requestJson<T>(cfg: OutlookTasksCfg, path: string): Promise<T> {
    const response = await this._request(cfg, { method: 'GET', path });
    return (await response.json()) as T;
  }
}
