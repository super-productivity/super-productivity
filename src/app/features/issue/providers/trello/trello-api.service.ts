import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { TrelloCfg } from './trello.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { SearchResultItem } from '../../issue.model';
import {
  TrelloCardResponse,
  TrelloSearchResponse,
  mapTrelloCardReduced,
  mapTrelloCardToIssue,
  mapTrelloSearchResults,
} from './trello-issue-map.util';
import { TrelloIssue, TrelloIssueReduced } from './trello-issue.model';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { ISSUE_PROVIDER_HUMANIZED, TRELLO_TYPE } from '../../issue.const';
import { T } from '../../../../t.const';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { getErrorTxt } from '../../../../util/get-error-text';

const BASE_URL = 'https://api.trello.com/1';
const DEFAULT_CARD_FIELDS = [
  'id',
  'idShort',
  'shortLink',
  'name',
  'url',
  'desc',
  'due',
  'dueComplete',
  'closed',
  'idBoard',
  'idList',
  'dateLastActivity',
].join(',');
const DEFAULT_ATTACHMENT_FIELDS = [
  'id',
  'name',
  'url',
  'bytes',
  'date',
  'mimeType',
  'previews',
  'edgeColor',
  'pos',
  'idMember',
].join(',');
const DEFAULT_MEMBER_FIELDS = ['fullName', 'username', 'avatarUrl'].join(',');

@Injectable({
  providedIn: 'root',
})
export class TrelloApiService {
  private _http = inject(HttpClient);
  private _snackService = inject(SnackService);

  private _memberIdCache: { [username: string]: string } = {};

  testConnection$(cfg: TrelloCfg): Observable<boolean> {
    return this._request$<{ id: string }>(`/boards/${cfg.boardId}`, cfg, {
      fields: 'id',
    }).pipe(map(() => true));
  }

  issuePicker$(
    searchTerm: string,
    cfg: TrelloCfg,
    maxResults: number = 25,
  ): Observable<SearchResultItem<'TRELLO'>[]> {
    const trimmed = searchTerm.trim();

    if (!trimmed) {
      return this._fetchBoardCards$(cfg, maxResults).pipe(
        map((cards) => mapTrelloSearchResults(cards)),
      );
    }

    const params = {
      query: trimmed,
      idBoards: cfg.boardId ?? undefined,
      modelTypes: 'cards',
      cards_limit: Math.min(maxResults, 100),
      card_fields: DEFAULT_CARD_FIELDS,
      card_attachments: 'true',
      card_attachment_fields: DEFAULT_ATTACHMENT_FIELDS,
      card_members: 'true',
      card_member_fields: DEFAULT_MEMBER_FIELDS,
      partial: 'true',
    } as const;

    return this._request$<TrelloSearchResponse>('/search', cfg, params).pipe(
      map((res) => mapTrelloSearchResults(res.cards || [])),
    );
  }

  findAutoImportIssues$(
    cfg: TrelloCfg,
    maxResults: number = 200,
  ): Observable<TrelloIssueReduced[]> {
    if (cfg.filterUsername) {
      return this.getCurrentMemberId$(cfg.filterUsername, cfg).pipe(
        switchMap((memberId) =>
          this._fetchBoardCards$(cfg, maxResults).pipe(
            map((cards) =>
              cards
                .filter(
                  (card) =>
                    card.members && card.members.some((member) => member.id === memberId),
                )
                .map((card) => mapTrelloCardReduced(card)),
            ),
          ),
        ),
        catchError(() =>
          // Fallback to returning all cards if username resolution fails
          this._fetchBoardCards$(cfg, maxResults).pipe(
            map((cards) => cards.map((card) => mapTrelloCardReduced(card))),
          ),
        ),
      );
    }
    return this._fetchBoardCards$(cfg, maxResults).pipe(
      map((cards) => cards.map((card) => mapTrelloCardReduced(card))),
    );
  }

  // list all projects from user
  getBoards$(cfg: TrelloCfg): Observable<any> {
    return this._request$('/members/me/boards', cfg, {
      filter: 'open',
      fields: 'name,id',
    });
  }

  getCurrentMemberId$(username: string, cfg: TrelloCfg): Observable<string> {
    if (this._memberIdCache[username]) {
      return of(this._memberIdCache[username]);
    }
    return this._request$<any>(`/members/${username}`, cfg, {
      fields: 'id',
    }).pipe(
      map((res) => {
        this._memberIdCache[username] = res.id;
        return res.id;
      }),
      catchError((error) => {
        const errorMsg = `Trello failed to resolve username "${username}": ${getErrorTxt(error)}`;
        console.error(errorMsg);
        this._snackService.open({
          type: 'ERROR',
          msg: errorMsg,
        });
        return throwError(() => new Error(errorMsg));
      }),
    );
  }

  getIssueById$(issueId: string, cfg: TrelloCfg): Observable<TrelloIssue> {
    return this._request$<TrelloCardResponse>(`/cards/${issueId}`, cfg, {
      fields: `${DEFAULT_CARD_FIELDS},labels`,
      attachments: 'true',
      attachment_fields: DEFAULT_ATTACHMENT_FIELDS,
      members: 'true',
      member_fields: DEFAULT_MEMBER_FIELDS,
    }).pipe(map((card) => mapTrelloCardToIssue(card)));
  }

  getReducedIssueById$(issueId: string, cfg: TrelloCfg): Observable<TrelloIssueReduced> {
    return this._request$<TrelloCardResponse>(`/cards/${issueId}`, cfg, {
      fields: DEFAULT_CARD_FIELDS,
      attachments: 'true',
      attachment_fields: DEFAULT_ATTACHMENT_FIELDS,
      members: 'true',
      member_fields: DEFAULT_MEMBER_FIELDS,
    }).pipe(map((card) => mapTrelloCardReduced(card)));
  }

  getCardUrl$(issueId: string, cfg: TrelloCfg): Observable<string> {
    return this._request$<{ url: string; shortLink: string }>(`/cards/${issueId}`, cfg, {
      fields: 'url,shortLink',
    }).pipe(map((card) => card.url || `https://trello.com/c/${card.shortLink}`));
  }

  private _fetchBoardCards$(
    cfg: TrelloCfg,
    maxResults: number,
  ): Observable<TrelloCardResponse[]> {
    const limit = Math.min(Math.max(maxResults, 1), 500);
    return this._request$<TrelloCardResponse[]>(`/boards/${cfg.boardId}/cards`, cfg, {
      filter: 'open',
      limit,
      fields: `${DEFAULT_CARD_FIELDS},labels`,
      attachments: 'true',
      attachment_fields: DEFAULT_ATTACHMENT_FIELDS,
      members: 'true',
      member_fields: DEFAULT_MEMBER_FIELDS,
    }).pipe(
      map((cards) => (Array.isArray(cards) ? cards : [])),
      map((cards) =>
        cards
          .slice()
          .sort(
            (a, b) =>
              new Date(b.dateLastActivity).getTime() -
              new Date(a.dateLastActivity).getTime(),
          )
          .slice(0, limit),
      ),
    );
  }

  private _request$<T>(
    path: string,
    cfg: TrelloCfg,
    params?: Record<string, unknown>,
  ): Observable<T> {
    this._checkSettings(cfg);
    const httpParams = this._createParams(cfg, params);
    return this._http
      .get<T>(`${BASE_URL}${path}`, {
        params: httpParams,
      })
      .pipe(catchError((err) => this._handleError$(err)));
  }

  private _createParams(cfg: TrelloCfg, params?: Record<string, unknown>): HttpParams {
    let httpParams = new HttpParams()
      .set('key', cfg.apiKey as string)
      .set('token', cfg.token as string);

    if (!params) {
      return httpParams;
    }

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((v) => {
          httpParams = httpParams.append(key, String(v));
        });
      } else {
        httpParams = httpParams.set(key, String(value));
      }
    });

    return httpParams;
  }

  private _checkSettings(cfg: TrelloCfg): void {
    if (!cfg || !cfg.apiKey || !cfg.token || !cfg.boardId) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[TRELLO_TYPE],
        },
      });
      throwHandledError('Trello: Not enough settings');
    }

    // Validate boardId format (should be alphanumeric, typically 24 chars for Trello - reference: https://community.developer.atlassian.com/t/uniqueness-of-trello-board-ids/67032/2)
    // const boardIdRegex = /^[a-zA-Z0-9]+$/;
    // remove this for now in favor of the trello board picker.
    // if (cfg.boardId && cfg.boardId.length !== 24) {
    //   this._snackService.open({
    //     type: 'ERROR',
    //     msg: `${ISSUE_PROVIDER_HUMANIZED[TRELLO_TYPE]}: Invalid board ID format`,
    //     isSkipTranslate: true,
    //   });
    //   throwHandledError('Trello: Invalid board ID format');
    // }
  }

  private _handleError$(error: HttpErrorResponse): Observable<never> {
    const issueProviderName = ISSUE_PROVIDER_HUMANIZED[TRELLO_TYPE];
    const errorTxt = getErrorTxt(error);
    const normalizedError = errorTxt.toLowerCase();
    let displayMessage = `${issueProviderName}: ${errorTxt}`;

    if (error.error instanceof ErrorEvent) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NETWORK,
        translateParams: {
          issueProviderName,
        },
      });
    } else if (
      normalizedError.includes('invalid') &&
      (normalizedError.includes('id') || normalizedError.includes('objectid'))
    ) {
      displayMessage = `${issueProviderName}: Invalid board ID. Please double-check the board ID in the Trello settings.`;
      this._snackService.open({
        type: 'ERROR',
        msg: displayMessage,
        isSkipTranslate: true,
      });
    } else if (error.error && typeof error.error === 'object' && error.error.message) {
      this._snackService.open({
        type: 'ERROR',
        msg: `${issueProviderName}: ${error.error.message}`,
        isSkipTranslate: true,
      });
    } else {
      this._snackService.open({
        type: 'ERROR',
        msg: `${issueProviderName}: ${errorTxt}`,
        isSkipTranslate: true,
      });
    }

    return throwError({
      [HANDLED_ERROR_PROP_STR]: displayMessage,
    });
  }
}
