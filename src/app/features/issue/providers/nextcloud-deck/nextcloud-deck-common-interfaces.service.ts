import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { first, map, tap } from 'rxjs/operators';
import { Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
} from './nextcloud-deck-issue.model';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { NextcloudDeckCfg } from './nextcloud-deck.model';
import { truncate } from '../../../../util/truncate';
import { isNextcloudDeckEnabled } from './is-nextcloud-deck-enabled.util';
import { NEXTCLOUD_DECK_POLL_INTERVAL } from './nextcloud-deck.const';

@Injectable({
  providedIn: 'root',
})
export class NextcloudDeckCommonInterfacesService extends BaseIssueProviderService<NextcloudDeckCfg> {
  private readonly _nextcloudDeckApiService = inject(NextcloudDeckApiService);
  private _cachedCfg?: NextcloudDeckCfg;

  readonly providerKey = 'NEXTCLOUD_DECK' as const;

  get pollInterval(): number {
    return this._cachedCfg?.pollIntervalMinutes
      ? this._cachedCfg.pollIntervalMinutes * 60 * 1000
      : NEXTCLOUD_DECK_POLL_INTERVAL;
  }

  isEnabled(cfg: NextcloudDeckCfg): boolean {
    return isNextcloudDeckEnabled(cfg);
  }

  testConnection(cfg: NextcloudDeckCfg): Promise<boolean> {
    return firstValueFrom(
      this._nextcloudDeckApiService.getBoards$(cfg).pipe(
        map((res) => Array.isArray(res)),
        first(),
      ),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => {
          let baseUrl = cfg.nextcloudBaseUrl || '';
          if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
          }
          return cfg.selectedBoardId
            ? `${baseUrl}/apps/deck/board/${cfg.selectedBoardId}/card/${issueId}`
            : '';
        }),
      ),
    ).then((result) => result ?? '');
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

  // Uses batch fetch of all open cards instead of per-task fetching
  override async getFreshDataForIssueTask(task: Task): Promise<{
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

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    const issue = await firstValueFrom(
      this._nextcloudDeckApiService.getById$(task.issueId, cfg),
    );

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
        issueTitle: truncate(issue.title),
      };
    }
    return null;
  }

  // Batch fetches all open cards for efficiency
  override async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: NextcloudDeckIssue }[]> {
    const issueProviderId =
      tasks && tasks.length > 0 && tasks[0].issueProviderId
        ? tasks[0].issueProviderId
        : '';
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const allCards: NextcloudDeckIssueReduced[] = await firstValueFrom(
      this._nextcloudDeckApiService.getOpenCards$(cfg),
    ).then((result) => result ?? []);

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

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<NextcloudDeckIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const allCards = await firstValueFrom(
      this._nextcloudDeckApiService.getOpenCards$(cfg),
    );
    const existingIds = new Set(allExistingIssueIds.map((id) => id.toString()));
    return (allCards ?? []).filter((card) => !existingIds.has(card.id.toString()));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: NextcloudDeckCfg,
  ): Observable<IssueData | null> {
    return this._nextcloudDeckApiService.getById$(id, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: NextcloudDeckCfg,
  ): Observable<SearchResultItem[]> {
    return this._nextcloudDeckApiService.searchOpenCards$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return truncate((issue as NextcloudDeckIssue).title);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return (issue as NextcloudDeckIssue).lastModified;
  }

  // Caches config for the pollInterval getter
  protected override _getCfgOnce$(issueProviderId: string): Observable<NextcloudDeckCfg> {
    return super._getCfgOnce$(issueProviderId).pipe(
      tap((cfg) => {
        this._cachedCfg = cfg;
      }),
    );
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
}
