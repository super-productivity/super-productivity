import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Task } from '../../../tasks/task.model';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { LogseqApiService } from './logseq-api.service';
import { SearchResultItem } from '../../issue.model';
import { LogseqCfg } from './logseq.model';
import { LogseqBlock, LogseqBlockReduced } from './logseq-issue.model';
import { isLogseqEnabled } from './is-logseq-enabled.util';
import { LOGSEQ_POLL_INTERVAL } from './logseq.const';
import { IssueProviderService } from '../../issue-provider.service';
import {
  extractFirstLine,
  mapBlockToIssueReduced,
  mapBlockToSearchResult,
} from './logseq-issue-map.util';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';

@Injectable({
  providedIn: 'root',
})
export class LogseqCommonInterfacesService implements IssueServiceInterface {
  private readonly _logseqApiService = inject(LogseqApiService);
  private readonly _issueProviderService = inject(IssueProviderService);

  pollInterval: number = LOGSEQ_POLL_INTERVAL;

  isEnabled(cfg: LogseqCfg): boolean {
    return isLogseqEnabled(cfg);
  }

  testConnection(cfg: LogseqCfg): Promise<boolean> {
    return this._logseqApiService
      .queryBlocks$(cfg, '[:find ?b :where [?b :block/uuid]]')
      .pipe(
        map((res) => Array.isArray(res)),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  issueLink(blockUuid: string, issueProviderId: string): Promise<string> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        map((cfg) =>
          cfg.linkFormat === 'logseq-url'
            ? `logseq://graph/logseq?block-id=${blockUuid}`
            : `http://localhost:12315/#/page/${blockUuid}`,
        ),
      )
      .toPromise()
      .then((result) => result ?? '');
  }

  getById(uuid: string, issueProviderId: string): Promise<LogseqBlock> {
    console.log('[Logseq Common] getById called with uuid:', uuid);
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        concatMap((cfg) => {
          console.log('[Logseq Common] Calling getBlockByUuid$ with cfg');
          return this._logseqApiService.getBlockByUuid$(uuid, cfg);
        }),
      )
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('Failed to get Logseq block');
        }
        console.log('[Logseq Common] getById result:', {
          uuid: result.uuid,
          marker: result.marker,
          content: result.content?.substring(0, 100),
        });
        return result;
      });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg) => {
          if (!this.isEnabled(cfg)) {
            return of([]);
          }

          // Wildcard '*' or empty search shows all tasks
          const isShowAll =
            searchTerm === '*' || !searchTerm || searchTerm.trim().length === 0;

          // Use custom query from config or default
          const baseQuery =
            cfg.queryFilter ||
            '[:find (pull ?b [*]) :where [?b :block/marker ?m] [(contains? #{"TODO" "DOING"} ?m)]]';

          // If showing all OR empty, use base query without filter
          // Otherwise, add content search filter
          const query = isShowAll
            ? baseQuery
            : baseQuery.replace(
                /\]\s*$/,
                `[?b :block/content ?content] [(clojure.string/includes? ?content "${searchTerm}")]]`,
              );

          return this._logseqApiService
            .queryBlocks$(cfg, query)
            .pipe(map((blocks) => blocks.map((block) => mapBlockToSearchResult(block))));
        }),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  getAddTaskData(block: LogseqBlockReduced): Partial<Task> & { title: string } {
    return {
      title: extractFirstLine(block.content),
      issueWasUpdated: false,
      issueLastUpdated: block.updatedAt,
      isDone: block.marker === 'DONE',
      issueMarker: block.marker,
    };
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: LogseqBlock;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await this._getCfgOnce$(task.issueProviderId).toPromise();
    if (!cfg) {
      throw new Error('No config found for issueProviderId');
    }

    const block = await this._logseqApiService
      .getBlockByUuid$(task.issueId as string, cfg)
      .toPromise();
    if (!block) {
      return null;
    }

    const wasUpdated = block.updatedAt > (task.issueLastUpdated || 0);
    const isDoneChanged = (block.marker === 'DONE') !== task.isDone;
    const isMarkerChanged = block.marker !== task.issueMarker;

    if (wasUpdated || isDoneChanged || isMarkerChanged) {
      return {
        taskChanges: {
          ...this.getAddTaskData(mapBlockToIssueReduced(block)),
          issueWasUpdated: true,
        },
        issue: block,
        issueTitle: extractFirstLine(block.content),
      };
    }
    return null;
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: LogseqBlock }[]> {
    return Promise.all(
      tasks.map((task) =>
        this.getFreshDataForIssueTask(task).then((refreshDataForTask) => ({
          task,
          refreshDataForTask,
        })),
      ),
    ).then((items) => {
      return items
        .filter(({ refreshDataForTask }) => !!refreshDataForTask)
        .map(({ refreshDataForTask, task }) => {
          if (!refreshDataForTask) {
            throw new Error('No refresh data for task js error');
          }
          return {
            task,
            taskChanges: refreshDataForTask.taskChanges,
            issue: refreshDataForTask.issue,
          };
        });
    });
  }

  getMappedAttachments(block: LogseqBlock): TaskAttachment[] {
    // Link is now shown in the Logseq issue details section instead of as attachment
    return [];
  }

  async getSubTasks(
    blockUuid: string,
    issueProviderId: string,
  ): Promise<LogseqBlockReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    if (!cfg) {
      return [];
    }

    const children = await this._logseqApiService
      .getBlockChildren$(blockUuid, cfg)
      .toPromise();
    if (!children) {
      return [];
    }

    return children
      .filter((child) => child.marker && ['TODO', 'DOING', 'DONE'].includes(child.marker))
      .map((child) => mapBlockToIssueReduced(child));
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<LogseqBlockReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    if (!cfg || !this.isEnabled(cfg)) {
      return [];
    }

    // Use custom query from config or default query
    const query =
      cfg.queryFilter ||
      '[:find (pull ?b [*]) :where [?b :block/marker ?m] [(contains? #{"TODO" "DOING"} ?m)]]';

    const blocks = await this._logseqApiService
      .queryBlocks$(cfg, query)
      .pipe(first())
      .toPromise();

    if (!blocks) {
      return [];
    }

    // Filter out blocks that already exist as tasks
    const existingUuids = new Set(allExistingIssueIds.map((id) => String(id)));
    return blocks
      .filter((block) => !existingUuids.has(block.uuid))
      .map((block) => mapBlockToIssueReduced(block));
  }

  async updateBlockMarker(
    blockUuid: string,
    issueProviderId: string,
    newMarker: 'TODO' | 'DOING' | 'LATER' | 'NOW' | 'DONE',
  ): Promise<void> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    if (!cfg || !cfg.isUpdateBlockOnTaskDone) {
      return;
    }

    const block = await this.getById(blockUuid, issueProviderId);

    // Update marker in content
    const updatedContent = block.content.replace(
      /^(TODO|DONE|DOING|LATER|WAITING|NOW)\s+/i,
      `${newMarker} `,
    );

    await this._logseqApiService
      .updateBlock$(block.uuid, updatedContent, cfg)
      .toPromise();
  }

  async updateIssueFromTask(task: Task): Promise<void> {
    // This method is kept for backwards compatibility but now uses updateBlockMarker
    if (!task.issueId || !task.issueProviderId) {
      return;
    }

    let marker: 'TODO' | 'DOING' | 'LATER' | 'DONE' = 'TODO';
    if (task.isDone) {
      marker = 'DONE';
    }

    await this.updateBlockMarker(task.issueId as string, task.issueProviderId, marker);
  }

  private _getCfgOnce$(issueProviderId: string): Observable<LogseqCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'LOGSEQ');
  }
}
