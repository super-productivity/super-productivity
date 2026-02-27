import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, first } from 'rxjs/operators';
import { NextcloudDeckCfg } from './nextcloud-deck.model';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
  DeckLabel,
  DeckAssignedUser,
} from './nextcloud-deck-issue.model';
import { NEXTCLOUD_DECK_TYPE, ISSUE_PROVIDER_HUMANIZED } from '../../issue.const';
import { SearchResultItem } from '../../issue.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { throwHandledError } from '../../../../util/throw-handled-error';

interface DeckBoardResponse {
  id: number;
  title: string;
  archived: boolean;
}

interface DeckCardResponse {
  id: number;
  title: string;
  description: string;
  duedate: string | null;
  lastModified: number;
  archived: boolean;
  done: boolean;
  order: number;
  labels: DeckLabel[];
  assignedUsers: DeckAssignedUser[];
}

interface DeckStackResponse {
  id: number;
  title: string;
  boardId: number;
  cards: DeckCardResponse[];
}

@Injectable({
  providedIn: 'root',
})
export class NextcloudDeckApiService {
  private readonly _snackService = inject(SnackService);
  private readonly _http = inject(HttpClient);

  getBoards$(cfg: NextcloudDeckCfg): Observable<DeckBoardResponse[]> {
    this._checkSettings(cfg);
    const url = `${this._getBaseUrl(cfg)}/boards`;
    return this._http
      .get<DeckBoardResponse[]>(url, { headers: this._getHeaders(cfg) })
      .pipe(
        map((boards) => boards.filter((b) => !b.archived)),
        catchError((err) => this._handleError(err)),
      );
  }

  getStacks$(cfg: NextcloudDeckCfg, boardId: number): Observable<DeckStackResponse[]> {
    this._checkSettings(cfg);
    const url = `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks`;
    return this._http
      .get<DeckStackResponse[]>(url, { headers: this._getHeaders(cfg) })
      .pipe(catchError((err) => this._handleError(err)));
  }

  updateCard$(
    cfg: NextcloudDeckCfg,
    boardId: number,
    stackId: number,
    cardId: number,
    changes: Partial<{ title: string; done: boolean }>,
  ): Observable<DeckCardResponse> {
    this._checkSettings(cfg);
    const url = `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks/${stackId}/cards/${cardId}`;
    const body: Record<string, unknown> = {
      type: 'plain',
      owner: cfg.username,
      ...changes,
    };
    if ('done' in changes) {
      body['done'] = changes.done ? new Date().toISOString() : null;
    }
    return this._http
      .put<DeckCardResponse>(url, body, { headers: this._getHeaders(cfg) })
      .pipe(catchError((err) => this._handleError(err)));
  }

  reorderCard$(
    cfg: NextcloudDeckCfg,
    boardId: number,
    stackId: number,
    cardId: number,
    targetStackId: number,
    order: number,
  ): Observable<DeckCardResponse> {
    this._checkSettings(cfg);
    const url = `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/reorder`;
    return this._http
      .put<DeckCardResponse>(
        url,
        { stackId: targetStackId, order },
        { headers: this._getHeaders(cfg) },
      )
      .pipe(catchError((err) => this._handleError(err)));
  }

  getOpenCards$(cfg: NextcloudDeckCfg): Observable<NextcloudDeckIssueReduced[]> {
    this._checkSettings(cfg);
    const boardId = cfg.selectedBoardId;
    if (!boardId) {
      return throwError(() => ({
        [HANDLED_ERROR_PROP_STR]: 'Nextcloud Deck: No board selected',
      }));
    }
    return this.getStacks$(cfg, boardId).pipe(
      map((stacks) => this._mapStacksToCards(stacks, cfg)),
    );
  }

  searchOpenCards$(
    searchTerm: string,
    cfg: NextcloudDeckCfg,
  ): Observable<SearchResultItem[]> {
    return this.getOpenCards$(cfg).pipe(
      map((cards) =>
        cards
          .filter((card) => card.title.toLowerCase().includes(searchTerm.toLowerCase()))
          .map((card) => ({
            title: card.title,
            issueType: NEXTCLOUD_DECK_TYPE as typeof NEXTCLOUD_DECK_TYPE,
            issueData: card,
          })),
      ),
    );
  }

  getById$(
    id: number | string,
    cfg: NextcloudDeckCfg,
  ): Observable<NextcloudDeckIssue | null> {
    this._checkSettings(cfg);
    const boardId = cfg.selectedBoardId;
    if (!boardId) {
      return throwError(() => ({
        [HANDLED_ERROR_PROP_STR]: 'Nextcloud Deck: No board selected',
      }));
    }
    const cardId = typeof id === 'string' ? parseInt(id, 10) : id;

    return from(this._findCardById(cfg, boardId, cardId)).pipe(
      catchError((err) => this._handleError(err)),
    );
  }

  private _getBaseUrl(cfg: NextcloudDeckCfg): string {
    let baseUrl = cfg.nextcloudBaseUrl || '';
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    return `${baseUrl}/index.php/apps/deck/api/v1.0`;
  }

  private _getHeaders(cfg: NextcloudDeckCfg): HttpHeaders {
    const credentials = btoa(
      unescape(encodeURIComponent(`${cfg.username}:${cfg.password}`)),
    );
    return new HttpHeaders({
      Authorization: `Basic ${credentials}`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
    });
  }

  private _mapStacksToCards(
    stacks: DeckStackResponse[],
    cfg: NextcloudDeckCfg,
  ): NextcloudDeckIssueReduced[] {
    const results: NextcloudDeckIssueReduced[] = [];
    for (const stack of stacks) {
      if (
        cfg.importStackIds &&
        cfg.importStackIds.length > 0 &&
        !cfg.importStackIds.includes(stack.id)
      ) {
        continue;
      }
      if (cfg.doneStackId && stack.id === cfg.doneStackId) {
        continue;
      }
      if (!stack.cards) {
        continue;
      }
      for (const card of stack.cards) {
        if (card.archived || card.done) {
          continue;
        }
        if (cfg.filterByAssignee && cfg.username) {
          const isAssigned = card.assignedUsers?.some(
            (u) => u.participant.uid === cfg.username,
          );
          if (!isAssigned) {
            continue;
          }
        }
        results.push({
          id: card.id,
          title: card.title,
          stackId: stack.id,
          stackTitle: stack.title,
          lastModified: card.lastModified,
          done: card.done,
          labels: card.labels || [],
        });
      }
    }
    return results;
  }

  private _mapCardToIssue(
    card: DeckCardResponse,
    stackId: number,
    stackTitle: string,
    boardId: number,
  ): NextcloudDeckIssue {
    return {
      id: card.id,
      title: card.title,
      description: card.description || '',
      duedate: card.duedate,
      lastModified: card.lastModified,
      done: card.done,
      order: card.order,
      labels: card.labels || [],
      assignedUsers: card.assignedUsers || [],
      stackId,
      stackTitle,
      boardId,
    };
  }

  private async _findCardById(
    cfg: NextcloudDeckCfg,
    boardId: number,
    cardId: number,
  ): Promise<NextcloudDeckIssue | null> {
    const url = `${this._getBaseUrl(cfg)}/boards/${boardId}/stacks`;
    const stacks = await this._http
      .get<DeckStackResponse[]>(url, { headers: this._getHeaders(cfg) })
      .pipe(first())
      .toPromise();
    if (!stacks) {
      return null;
    }
    for (const stack of stacks) {
      if (!stack.cards) {
        continue;
      }
      for (const card of stack.cards) {
        if (card.id === cardId) {
          return this._mapCardToIssue(card, stack.id, stack.title, boardId);
        }
      }
    }
    return null;
  }

  private _checkSettings(cfg: NextcloudDeckCfg): void {
    if (!cfg || !cfg.nextcloudBaseUrl || !cfg.username || !cfg.password) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[NEXTCLOUD_DECK_TYPE],
        },
      });
      throwHandledError('Nextcloud Deck: Not enough settings');
    }
  }

  private _handleError(err: unknown): Observable<never> {
    this._snackService.open({
      type: 'ERROR',
      msg: T.F.ISSUE.S.ERR_NETWORK,
      translateParams: {
        issueProviderName: ISSUE_PROVIDER_HUMANIZED[NEXTCLOUD_DECK_TYPE],
      },
    });
    const errMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? (err as { message: string }).message
          : String(err);
    return throwError(() => ({
      [HANDLED_ERROR_PROP_STR]: 'Nextcloud Deck: ' + errMsg,
    }));
  }
}
