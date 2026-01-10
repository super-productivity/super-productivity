import { inject, Injectable } from '@angular/core';
import { nanoid } from 'nanoid';
import { ChromeExtensionInterfaceService } from '../../../../core/chrome-extension-interface/chrome-extension-interface.service';
import {
  JIRA_ADDITIONAL_ISSUE_FIELDS,
  JIRA_MAX_RESULTS,
  JIRA_REQUEST_TIMEOUT_DURATION,
} from './jira.const';
import {
  mapIssueResponse,
  mapIssuesResponse,
  mapResponse,
  mapToSearchResults,
  mapToSearchResultsForJQL,
  mapTransitionResponse,
} from './jira-issue-map.util';
import {
  JiraOriginalStatus,
  JiraOriginalTransition,
  JiraOriginalUser,
} from './jira-api-responses';
import { JiraCfg } from './jira.model';
import { IPC } from '../../../../../../electron/shared-with-frontend/ipc-events.const';
import { SnackService } from '../../../../core/snack/snack.service';
import { HANDLED_ERROR_PROP_STR, IS_ELECTRON } from '../../../../app.constants';
import { from, Observable, of, throwError } from 'rxjs';
import { SearchResultItem } from '../../issue.model';
import {
  catchError,
  concatMap,
  finalize,
  first,
  mapTo,
  shareReplay,
  take,
  timeoutWith,
} from 'rxjs/operators';
import { JiraIssue, JiraIssueReduced } from './jira-issue.model';
import { BannerService } from '../../../../core/banner/banner.service';
import { BannerId } from '../../../../core/banner/banner.model';
import { T } from '../../../../t.const';
import { stringify } from 'query-string';
import { getErrorTxt } from '../../../../util/get-error-text';
import { isOnline } from '../../../../util/is-online';
import { GlobalProgressBarService } from '../../../../core-ui/global-progress-bar/global-progress-bar.service';
import { IpcRendererEvent } from 'electron';
import { SS } from '../../../../core/persistence/storage-keys.const';
import { MatDialog } from '@angular/material/dialog';
import { DialogPromptComponent } from '../../../../ui/dialog-prompt/dialog-prompt.component';
import { stripTrailing } from '../../../../util/strip-trailing';
import { IS_ANDROID_WEB_VIEW } from '../../../../util/is-android-web-view';
import { formatJiraDate } from '../../../../util/format-jira-date';
import { IssueLog } from '../../../../core/log';

const BLOCK_ACCESS_KEY = 'SUP_BLOCK_JIRA_ACCESS';
const API_VERSION = 'latest';

interface JiraRequestLogItem {
  transform: (res: any, cfg: any) => any;
  requestInit: RequestInit;
  timeoutId: number;
  jiraCfg: JiraCfg;

  resolve(res: any): Promise<void>;

  reject(reason?: any): Promise<unknown>;
}

interface JiraRequestCfg {
  pathname: string;
  followAllRedirects?: boolean;
  method?: 'GET' | 'POST' | 'PUT';
  query?: {
    [key: string]: string | boolean | number | string[];
  };
  transform?: (res: any, jiraCfg?: JiraCfg) => any;
  body?: Record<string, unknown>;
}

@Injectable({
  providedIn: 'root',
})
export class JiraApiService {
  private _chromeExtensionInterfaceService = inject(ChromeExtensionInterfaceService);
  private _globalProgressBarService = inject(GlobalProgressBarService);
  private _snackService = inject(SnackService);
  private _bannerService = inject(BannerService);
  private _matDialog = inject(MatDialog);

  private _requestsLog: { [key: string]: JiraRequestLogItem } = {};
  private _isBlockAccess: boolean = !!sessionStorage.getItem(BLOCK_ACCESS_KEY);
  private _isExtension: boolean = false;
  private _isInterfacesReadyIfNeeded$: Observable<boolean> =
    IS_ELECTRON || IS_ANDROID_WEB_VIEW
      ? of(true).pipe()
      : this._chromeExtensionInterfaceService.onReady$.pipe(
          mapTo(true),
          shareReplay(1),
          timeoutWith(
            500,
            throwError({
              [HANDLED_ERROR_PROP_STR]: 'Jira: Extension not installed or not ready',
            }),
          ),
        );

  constructor() {
    // set up callback listener for electron
    if (IS_ELECTRON) {
      window.ea.on(IPC.JIRA_CB_EVENT, (ev: IpcRendererEvent, res: any) => {
        this._handleResponse(res);
      });
    }

    this._chromeExtensionInterfaceService.onReady$.subscribe(() => {
      this._isExtension = true;
      this._chromeExtensionInterfaceService.addEventListener(
        'SP_JIRA_RESPONSE',
        (ev: unknown, data: any) => {
          this._handleResponse(data);
        },
      );
    });
  }

  unblockAccess(): void {
    this._isBlockAccess = false;
    sessionStorage.removeItem(BLOCK_ACCESS_KEY);
  }

  search$(searchTermJQL: string, cfg: JiraCfg): Observable<SearchResultItem[]> {
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: 'search/jql',
        followAllRedirects: true,
        query: {
          jql: searchTermJQL,
          // fields: [
          //   ...JIRA_ADDITIONAL_ISSUE_FIELDS,
          //   ...(cfg.storyPointFieldId ? [cfg.storyPointFieldId] : []),
          // ],
        },
        transform: mapToSearchResultsForJQL,
        // NOTE: we pass the cfg as well to avoid race conditions
      },
      cfg,
      suppressErrorSnack: true,
    }).pipe(
      // switchMap((res) =>
      //   res.length > 0 ? of(res) : this.issuePicker$(searchTerm, cfg),
      // ),
      catchError((err) => {
        const code = err?.error?.statusCode ?? err?.status ?? err?.error?.status;
        if (code === 404) {
          // Fallback for Server/DC: /search?jql=...
          return this._sendRequest$({
            jiraReqCfg: {
              pathname: 'search',
              followAllRedirects: true,
              query: { jql: searchTermJQL },
              transform: mapToSearchResultsForJQL,
            },
            cfg,
          });
        }
        return throwError(() => err);
      }),
    );
  }

  issuePicker$(searchTerm: string, cfg: JiraCfg): Observable<SearchResultItem[]> {
    const searchStr = `${searchTerm}`;

    return this._sendRequest$({
      jiraReqCfg: {
        pathname: 'issue/picker',
        followAllRedirects: true,
        query: {
          showSubTasks: true,
          showSubTaskParent: true,
          query: searchStr,
          currentJQL: cfg.searchJqlQuery || '',
        },
        transform: mapToSearchResults,
        // NOTE: we pass the cfg as well to avoid race conditions
      },
      cfg,
    })
      .pipe
      // switchMap((res) =>
      //   res.length > 0 ? of(res) : this.fallBackSearch$(searchTerm, cfg),
      // ),
      ();
  }

  listFields$(cfg: JiraCfg): Observable<any> {
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: 'field',
      },
      cfg,
    });
  }

  findAutoImportIssues$(
    cfg: JiraCfg,
    isFetchAdditional?: boolean,
    maxResults: number = JIRA_MAX_RESULTS,
  ): Observable<JiraIssueReduced[]> {
    const options = {
      maxResults,
      fields: [
        ...JIRA_ADDITIONAL_ISSUE_FIELDS,
        ...(cfg.storyPointFieldId ? [cfg.storyPointFieldId] : []),
      ],
    };
    const searchQuery = cfg.autoAddBacklogJqlQuery;

    if (!searchQuery) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.JIRA.S.NO_AUTO_IMPORT_JQL,
      });
      return throwError({
        [HANDLED_ERROR_PROP_STR]: 'JiraApi: No search query for auto import',
      });
    }

    return this._sendRequest$({
      jiraReqCfg: {
        transform: mapIssuesResponse as (res: any, cfg?: JiraCfg) => any,
        pathname: 'search/jql',
        method: 'POST',
        body: {
          ...options,
          jql: searchQuery,
        },
      },
      cfg,
      suppressErrorSnack: true,
    }).pipe(
      catchError((err) => {
        const code = err?.error?.statusCode ?? err?.status ?? err?.error?.status;
        if (code === 401 || code === 403) return throwError(() => err);
        // Fallback for Server/DC: POST /search with jql in body
        return this._sendRequest$({
          jiraReqCfg: {
            transform: mapIssuesResponse as (res: any, cfg?: JiraCfg) => any,
            pathname: 'search',
            method: 'POST',
            body: { ...options, jql: searchQuery },
          },
          cfg,
        });
      }),
    );
  }

  getIssueById$(issueId: string, cfg: JiraCfg): Observable<JiraIssue> {
    return this._getIssueById$(issueId, cfg, true);
  }

  getReducedIssueById$(issueId: string, cfg: JiraCfg): Observable<JiraIssueReduced> {
    return this._getIssueById$(issueId, cfg, false);
  }

  getCurrentUser$(cfg: JiraCfg, isForce: boolean = false): Observable<JiraOriginalUser> {
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: `myself`,
        transform: mapResponse,
      },
      cfg,
      isForce,
    });
  }

  listStatus$(cfg: JiraCfg): Observable<JiraOriginalStatus[]> {
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: `status`,
        transform: mapResponse,
      },
      cfg,
    });
  }

  getTransitionsForIssue$(
    issueId: string,
    cfg: JiraCfg,
  ): Observable<JiraOriginalTransition[]> {
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: `issue/${issueId}/transitions`,
        method: 'GET',
        query: {
          expand: 'transitions.fields',
        },
        transform: mapTransitionResponse,
      },
      cfg,
    });
  }

  transitionIssue$(issueId: string, transitionId: string, cfg: JiraCfg): Observable<any> {
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: `issue/${issueId}/transitions`,
        method: 'POST',
        body: {
          transition: {
            id: transitionId,
          },
        },
        transform: mapResponse,
      },
      cfg,
    });
  }

  updateAssignee$(issueId: string, accountId: string, cfg: JiraCfg): Observable<any> {
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: `issue/${issueId}/assignee`,
        method: 'PUT',
        body: {
          accountId,
        },
      },
      cfg,
    });
  }

  addWorklog$({
    issueId,
    started,
    timeSpent,
    comment,
    cfg,
  }: {
    issueId: string;
    started: string;
    timeSpent: number;
    comment: string;
    cfg: JiraCfg;
  }): Observable<any> {
    const worklog = {
      started: formatJiraDate(started),
      timeSpentSeconds: Math.floor(timeSpent / 1000),
      comment,
    };
    return this._sendRequest$({
      jiraReqCfg: {
        pathname: `issue/${issueId}/worklog`,
        method: 'POST',
        body: worklog,
        transform: mapResponse,
      },
      cfg,
    });
  }

  private _getIssueById$(
    issueId: string,
    cfg: JiraCfg,
    isGetChangelog: boolean = false,
  ): Observable<JiraIssue> {
    return this._sendRequest$({
      jiraReqCfg: {
        transform: mapIssueResponse as (res: any, cfg?: JiraCfg) => any,
        pathname: `issue/${issueId}`,
        query: {
          expand: isGetChangelog ? ['changelog', 'description'] : ['description'],
        },
      },
      cfg,
    });
  }

  // Complex Functions

  // --------
  private _isMinimalSettings(settings: JiraCfg): boolean {
    return !!(
      settings &&
      settings.host &&
      settings.userName &&
      settings.password &&
      (IS_ELECTRON || this._isExtension || IS_ANDROID_WEB_VIEW)
    );
  }

  private _sendRequest$({
    jiraReqCfg,
    cfg,
    isForce = false,
    suppressErrorSnack = false,
  }: {
    jiraReqCfg: JiraRequestCfg;
    cfg: JiraCfg;
    isForce?: boolean;
    suppressErrorSnack?: boolean;
  }): Observable<any> {
    return this._isInterfacesReadyIfNeeded$.pipe(
      take(1),
      concatMap(() => {
        // assign uuid to request to know which responsive belongs to which promise
        const requestId = `${jiraReqCfg.pathname}__${
          jiraReqCfg.method || 'GET'
        }__${nanoid()}`;

        if (!isOnline()) {
          this._snackService.open({
            type: 'CUSTOM',
            msg: T.G.NO_CON,
            ico: 'cloud_off',
          });
          return throwError({ [HANDLED_ERROR_PROP_STR]: 'Jira Offline ' + requestId });
        }

        if (!this._isMinimalSettings(cfg)) {
          this._snackService.open({
            type: 'ERROR',
            msg:
              !IS_ELECTRON && !this._isExtension && !IS_ANDROID_WEB_VIEW
                ? T.F.JIRA.S.EXTENSION_NOT_LOADED
                : T.F.JIRA.S.INSUFFICIENT_SETTINGS,
          });
          return throwError({
            [HANDLED_ERROR_PROP_STR]: 'Insufficient Settings for Jira ' + requestId,
          });
        }

        if (this._isBlockAccess && !isForce) {
          IssueLog.err('Blocked Jira Access to prevent being shut out');
          this._bannerService.open({
            id: BannerId.JiraUnblock,
            msg: T.F.JIRA.BANNER.BLOCK_ACCESS_MSG,
            svgIco: 'jira',
            action: {
              label: T.F.JIRA.BANNER.BLOCK_ACCESS_UNBLOCK,
              fn: () => this.unblockAccess(),
            },
          });
          return throwError({
            [HANDLED_ERROR_PROP_STR]:
              'Blocked access to prevent being shut out ' + requestId,
          });
        }

        // BUILD REQUEST START
        // -------------------
        const requestInit = this._makeRequestInit(jiraReqCfg, cfg);

        const queryStr = jiraReqCfg.query
          ? `?${stringify(jiraReqCfg.query, { arrayFormat: 'comma' })}`
          : '';
        const base = `${stripTrailing(cfg.host || 'null', '/')}/rest/api/${API_VERSION}`;
        const url = `${base}/${jiraReqCfg.pathname}${queryStr}`.trim();

        return this._sendRequestToExecutor$(
          requestId,
          url,
          requestInit,
          jiraReqCfg.transform,
          cfg,
          suppressErrorSnack,
        );
        // NOTE: offline is sexier & easier than cache, but in case we change our mind...
        // const args = [requestId, url, requestInit, jiraReqCfg.transform];
        // return this._issueCacheService.cache(url, requestInit, this._sendRequestToExecutor$.bind(this), args);
      }),
    );
  }

  private _sendRequestToExecutor$(
    requestId: string,
    url: string,
    requestInit: RequestInit,
    transform: any,
    jiraCfg: JiraCfg,
    suppressErrorSnack: boolean,
  ): Observable<any> {
    // TODO refactor to observable for request canceling etc
    let promiseResolve;
    let promiseReject;
    const promise = new Promise((resolve, reject) => {
      promiseResolve = resolve;
      promiseReject = reject;
    });

    // save to request log (also sets up timeout)
    // since we don't use the requestLog anyway on android web view we can just use the requestId
    if (!IS_ANDROID_WEB_VIEW) {
      this._requestsLog[requestId] = this._makeJiraRequestLogItem({
        promiseResolve,
        promiseReject,
        requestId,
        requestInit,
        transform,
        jiraCfg,
      });
    }

    const requestToSend = { requestId, requestInit, url };
    if (IS_ELECTRON) {
      window.ea.makeJiraRequest({
        ...requestToSend,
        jiraCfg,
      });
    } else if (this._isExtension) {
      this._chromeExtensionInterfaceService.dispatchEvent(
        'SP_JIRA_REQUEST',
        requestToSend,
      );
    } else if (IS_ANDROID_WEB_VIEW) {
      return from(
        fetch(url, requestInit)
          .then((response) => response.body)
          .then(streamToJsonIfPossible as any)
          .then((res) => {
            if ((res as any)?.errorMessages?.length) {
              throw new Error((res as any).errorMessages.join(', '));
            }
            return transform ? transform({ response: res }, jiraCfg) : { response: res };
          }),
      ).pipe(
        catchError((err) => {
          IssueLog.log(err);
          IssueLog.log(getErrorTxt(err));
          const errTxt = `Jira: ${getErrorTxt(err)}`;
          if (!suppressErrorSnack) {
            this._snackService.open({ type: 'ERROR', msg: errTxt });
          }
          return throwError({ [HANDLED_ERROR_PROP_STR]: errTxt });
        }),
      );
    } else {
      throw new Error('Jira: No valid interface found');
    }

    this._globalProgressBarService.countUp(url);
    return from(promise).pipe(
      catchError((err) => {
        IssueLog.log(err);
        IssueLog.log(getErrorTxt(err));
        const errTxt = `Jira: ${getErrorTxt(err)}`;
        if (!suppressErrorSnack) {
          this._snackService.open({ type: 'ERROR', msg: errTxt });
        }
        return throwError({ [HANDLED_ERROR_PROP_STR]: errTxt });
      }),
      first(),
      finalize(() => this._globalProgressBarService.countDown()),
    );
  }

  private _makeRequestInit(jr: JiraRequestCfg, cfg: JiraCfg): RequestInit {
    return {
      method: jr.method || 'GET',

      ...(jr.body ? { body: JSON.stringify(jr.body) } : {}),

      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
        ...(cfg.usePAT
          ? {
              Cookie: '',
              authorization: `Bearer ${cfg.password}`,
            }
          : {
              Cookie: '',
              authorization: `Basic ${this._b64EncodeUnicode(
                `${cfg.userName}:${cfg.password}`,
              )}`,
            }),
      },
    };
  }

  private async _checkSetWonkyCookie(cfg: JiraCfg): Promise<string | null> {
    const ssVal = sessionStorage.getItem(SS.JIRA_WONKY_COOKIE);
    if (ssVal && ssVal.length > 0) {
      return ssVal;
    } else {
      const loginUrl = `${cfg.host}`;
      const apiUrl = `${cfg.host}/rest/api/${API_VERSION}/myself`;

      const val = await this._matDialog
        .open(DialogPromptComponent, {
          data: {
            // TODO add message to translations
            placeholder: 'Insert Cookie String',
            message: `<h3>Jira Wonky Cookie Authentication</h3>
<ol>
  <li><a href="${loginUrl}">Log into Jira from your browser</a></li>
  <li><a href="${apiUrl}" target="_blank">Go to this api url</a></li>
  <li>Open up the dev tools (Ctrl+Shift+i)</li>
  <li>Navigate to the "Network" tab and reload page</li>
  <li>Click the "myself" file on the left side.</li>
  <li>In the "Headers" tab, scroll down and locate the "Request Headers" section.</li>
  <li>Locate the "cookie" header and right click to copy the value</li>
  <li>Fill this form with the cookie as "cookie: {paste-cookie-value}"</li>
</ol>`,
          },
        })
        .afterClosed()
        .toPromise();

      if (typeof val === 'string') {
        sessionStorage.setItem(SS.JIRA_WONKY_COOKIE, val);
        return val;
      }
    }

    this._blockAccess();
    return null;
  }

  private _makeJiraRequestLogItem({
    promiseResolve,
    promiseReject,
    requestId,
    requestInit,
    transform,
    jiraCfg,
  }: {
    promiseResolve: any;
    promiseReject: any;
    requestId: string;
    requestInit: RequestInit;
    transform: any;
    jiraCfg: JiraCfg;
  }): JiraRequestLogItem {
    return {
      transform,
      resolve: promiseResolve,
      reject: promiseReject,
      // NOTE: only needed for debug
      requestInit,
      jiraCfg,

      timeoutId: window.setTimeout(() => {
        IssueLog.log('ERROR', 'Jira Request timed out', requestInit);
        this._blockAccess();
        // delete entry for promise
        this._snackService.open({
          msg: T.F.JIRA.S.TIMED_OUT,
          type: 'ERROR',
        });
        this._requestsLog[requestId].reject('Request timed out');
        delete this._requestsLog[requestId];
      }, JIRA_REQUEST_TIMEOUT_DURATION),
    };
  }

  private _handleResponse(res: { requestId?: string; error?: any }): void {
    // check if proper id is given in callback and if exists in requestLog
    if (res.requestId && this._requestsLog[res.requestId]) {
      const currentRequest = this._requestsLog[res.requestId];
      // cancel timeout for request
      window.clearTimeout(currentRequest.timeoutId);

      // resolve saved promise
      if (!res || res.error) {
        IssueLog.err('JIRA_RESPONSE_ERROR', res, currentRequest);
        // let msg =
        if (
          res?.error &&
          (res.error.statusCode === 401 ||
            res.error === 401 ||
            res.error.message === 'Forbidden' ||
            res.error.message === 'Unauthorized')
        ) {
          this._blockAccess();
        }

        currentRequest.reject(res);
      } else {
        // IssueLog.log('JIRA_RESPONSE', res);
        if (currentRequest.transform) {
          // data can be invalid, that's why we check
          try {
            currentRequest.resolve(currentRequest.transform(res, currentRequest.jiraCfg));
          } catch (e) {
            IssueLog.log(res);
            IssueLog.log(currentRequest);
            IssueLog.err(e);
            this._snackService.open({
              type: 'ERROR',
              msg: T.F.JIRA.S.INVALID_RESPONSE,
            });
          }
        } else {
          currentRequest.resolve(res);
        }
      }
      // delete entry for promise afterwards
      delete this._requestsLog[res.requestId];
    } else {
      IssueLog.err('Jira: Response Request ID not existing', res && res.requestId);
    }
  }

  private _blockAccess(): void {
    // TODO also shut down all existing requests
    this._isBlockAccess = true;
    sessionStorage.setItem(BLOCK_ACCESS_KEY, 'true');
    sessionStorage.removeItem(SS.JIRA_WONKY_COOKIE);
  }

  private _b64EncodeUnicode(str: string): string {
    if (typeof (btoa as any) === 'function') {
      return btoa(str);
    }
    throw new Error('Jira: btoo not supported');
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  let done = false;

  while (!done) {
    const { value, done: doneReading } = await reader.read();
    done = doneReading;
    if (value) {
      result += decoder.decode(value, { stream: true });
    }
  }

  result += decoder.decode(); // flush the decoder
  return result;
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
async function streamToJsonIfPossible(stream: ReadableStream): Promise<any> {
  const text = await streamToString(stream);
  try {
    return JSON.parse(text);
  } catch (e) {
    IssueLog.err('Jira: Could not parse response', text);
    return text;
  }
}
