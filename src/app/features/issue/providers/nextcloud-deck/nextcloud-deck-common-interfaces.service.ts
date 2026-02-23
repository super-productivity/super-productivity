import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { IssueServiceInterface } from '../../issue-service-interface';
import { IssueProviderNextcloudDeck, SearchResultItem } from '../../issue.model';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
} from './nextcloud-deck-issue.model';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { NextcloudDeckCfg } from './nextcloud-deck.model';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { truncate } from '../../../../util/truncate';
import { isNextcloudDeckEnabled } from './is-nextcloud-deck-enabled.util';
import { NEXTCLOUD_DECK_POLL_INTERVAL } from './nextcloud-deck.const';
import { IssueProviderService } from '../../issue-provider.service';

@Injectable({
  providedIn: 'root',
})
export class NextcloudDeckCommonInterfacesService implements IssueServiceInterface {
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _nextcloudDeckApiService = inject(NextcloudDeckApiService);
  private _cachedCfg?: NextcloudDeckCfg;

  private static _formatIssueTitleForSnack(title: string): string {
    return truncate(title);
  }

  get pollInterval(): number {
    return this._cachedCfg?.pollIntervalMinutes
      ? this._cachedCfg.pollIntervalMinutes * 60 * 1000
      : NEXTCLOUD_DECK_POLL_INTERVAL;
  }

  isEnabled(cfg: NextcloudDeckCfg): boolean {
    return isNextcloudDeckEnabled(cfg);
  }

  testConnection(cfg: NextcloudDeckCfg): Promise<boolean> {
    return this._nextcloudDeckApiService
      .getBoards$(cfg)
      .pipe(
        map((res) => Array.isArray(res)),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  getAddTaskData(
    issueData: NextcloudDeckIssueReduced | NextcloudDeckIssue,
    cfg?: NextcloudDeckCfg,
  ): Partial<Task> & { title: string } {
    return {
      title: this._formatTitle(issueData, cfg || this._cachedCfg),
      issueLastUpdated: issueData.lastModified,
      notes: (issueData as NextcloudDeckIssue).description || undefined,
    };
  }

  getById(
    id: string | number,
    issueProviderId: string,
  ): Promise<NextcloudDeckIssue | null> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(concatMap((cfg) => this._nextcloudDeckApiService.getById$(id, cfg)))
      .toPromise()
      .then((result) => result ?? null);
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        map((cfg) => {
          let baseUrl = cfg.nextcloudBaseUrl || '';
          if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
          }
          return cfg.selectedBoardId
            ? `${baseUrl}/apps/deck/board/${cfg.selectedBoardId}/card/${issueId}`
            : '';
        }),
      )
      .toPromise()
      .then((result) => result ?? '');
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: NextcloudDeckIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await this._getCfgOnce$(task.issueProviderId).toPromise();
    const issue = await this._nextcloudDeckApiService
      .getById$(task.issueId, cfg)
      .pipe(first())
      .toPromise();

    if (!issue) {
      return null;
    }

    const wasUpdated = issue.lastModified !== task.issueLastUpdated;

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue, cfg),
          issueWasUpdated: true,
          isDone: issue.done,
        },
        issue,
        issueTitle: NextcloudDeckCommonInterfacesService._formatIssueTitleForSnack(
          issue.title,
        ),
      };
    }
    return null;
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: NextcloudDeckIssue }[]> {
    const issueProviderId =
      tasks && tasks.length > 0 && tasks[0].issueProviderId
        ? tasks[0].issueProviderId
        : '';
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    const allCards: NextcloudDeckIssueReduced[] = await this._nextcloudDeckApiService
      .getOpenCards$(cfg)
      .pipe(first())
      .toPromise()
      .then((result) => result ?? []);

    const cardMap = new Map(allCards.map((card) => [card.id.toString(), card]));

    return tasks
      .filter((task) => {
        const card = cardMap.get(task.issueId as string);
        return card && card.lastModified !== task.issueLastUpdated;
      })
      .map((task) => {
        const card = cardMap.get(task.issueId as string) as NextcloudDeckIssueReduced;
        return {
          task,
          taskChanges: {
            ...this.getAddTaskData(card, cfg),
            issueWasUpdated: true,
            isDone: card.done,
          },
          issue: card as NextcloudDeckIssue,
        };
      });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg) =>
          this.isEnabled(cfg)
            ? this._nextcloudDeckApiService.searchOpenCards$(searchTerm, cfg)
            : of([]),
        ),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<NextcloudDeckIssueReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    const allCards = await this._nextcloudDeckApiService
      .getOpenCards$(cfg)
      .pipe(first())
      .toPromise();
    const existingIds = new Set(allExistingIssueIds.map((id) => id.toString()));
    return (allCards ?? []).filter((card) => !existingIds.has(card.id.toString()));
  }

  private _formatTitle(
    issueData: NextcloudDeckIssueReduced | NextcloudDeckIssue,
    cfg?: NextcloudDeckCfg,
  ): string {
    const template = cfg?.titleTemplate;
    if (!template) {
      return issueData.title;
    }
    return template
      .replace(/\{CARD_TITLE}/g, issueData.title)
      .replace(/\{COLUMN}/g, issueData.stackTitle || '')
      .replace(/\{BOARD}/g, cfg?.selectedBoardTitle || '')
      .replace(/\{ID}/g, String(issueData.id))
      .replace(/\{LABELS}/g, (issueData.labels || []).map((l) => l.title).join(', '));
  }

  private _getCfgOnce$(
    issueProviderId: string | number,
  ): Observable<IssueProviderNextcloudDeck> {
    return this._issueProviderService
      .getCfgOnce$(issueProviderId.toString(), 'NEXTCLOUD_DECK')
      .pipe(
        map((cfg) => {
          this._cachedCfg = cfg;
          return cfg;
        }),
      );
  }
}
