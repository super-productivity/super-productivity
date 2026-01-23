import { Injectable, inject } from '@angular/core';
import { Observable, of, Subject, firstValueFrom } from 'rxjs';
import { Task } from '../../../tasks/task.model';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { LogseqApiService } from './logseq-api.service';
import { SearchResultItem } from '../../issue.model';
import { LogseqCfg } from './logseq.model';
import { LogseqBlock, LogseqBlockReduced } from './logseq-issue.model';
import { isLogseqEnabled } from './is-logseq-enabled.util';
import {
  DEFAULT_LOGSEQ_CFG,
  LOGSEQ_MARKER_REGEX,
  LOGSEQ_POLL_INTERVAL,
  LOGSEQ_SEARCH_WILDCARD,
  LOGSEQ_TYPE,
} from './logseq.const';
import { IssueProviderService } from '../../issue-provider.service';
import { TaskService } from '../../../tasks/task.service';
import {
  extractFirstLine,
  extractScheduledDate,
  extractScheduledDateTime,
  extractSpDrawerData,
  calculateContentHash,
  updateSpDrawerInContent,
  mapBlockToIssueReduced,
  mapBlockToSearchResult,
  updateScheduledInContent,
} from './logseq-issue-map.util';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { LogseqLog } from '../../../../core/log';

export type DiscrepancyType =
  | 'LOGSEQ_DONE_SUPERPROD_NOT_DONE'
  | 'SUPERPROD_DONE_LOGSEQ_NOT_DONE'
  | 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE'
  | 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE';

export interface DiscrepancyItem {
  task: Task;
  block: LogseqBlock;
  discrepancyType: DiscrepancyType;
}

@Injectable({
  providedIn: 'root',
})
export class LogseqCommonInterfacesService implements IssueServiceInterface {
  private readonly _logseqApiService = inject(LogseqApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _taskService = inject(TaskService);

  pollInterval: number = LOGSEQ_POLL_INTERVAL;

  // Write-mutex: Set of blockUuids currently being written to
  // Used to skip discrepancy detection during writes
  private _blocksBeingWritten = new Set<string>();

  // Subject for emitting discrepancies detected during polling
  discrepancies$ = new Subject<DiscrepancyItem>();

  isEnabled(cfg: LogseqCfg): boolean {
    return isLogseqEnabled(cfg);
  }

  testConnection(cfg: LogseqCfg): Promise<boolean> {
    return firstValueFrom(
      this._logseqApiService.queryBlocks$(cfg, '[:find ?b :where [?b :block/uuid]]').pipe(
        map((res) => Array.isArray(res)),
        first(),
      ),
    )
      .then((result) => result ?? false)
      .catch(() => false);
  }

  issueLink(blockUuid: string, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) =>
          cfg.linkFormat === 'logseq-url'
            ? `logseq://graph/logseq?block-id=${blockUuid}`
            : `http://localhost:12315/#/page/${blockUuid}`,
        ),
      ),
    ).then((result) => result ?? '');
  }

  getById(uuid: string, issueProviderId: string): Promise<LogseqBlock> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        concatMap((cfg) => this._logseqApiService.getBlockByUuid$(uuid, cfg)),
      ),
    ).then((result) => {
      if (!result) {
        throw new Error('Failed to get Logseq block');
      }

      return result;
    });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((cfg) => {
          if (!this.isEnabled(cfg)) {
            return of([]);
          }

          // Wildcard or empty search shows all tasks
          const isShowAll =
            searchTerm === LOGSEQ_SEARCH_WILDCARD ||
            !searchTerm ||
            searchTerm.trim().length === 0;

          // Use custom query from config or default
          const baseQuery = cfg.queryFilter || DEFAULT_LOGSEQ_CFG.queryFilter;

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
      ),
    ).then((result) => result ?? []);
  }

  getAddTaskData(block: LogseqBlockReduced): Partial<Task> & { title: string } {
    const todayStr = getDbDateStr();

    // Base data that's always included
    const baseData = {
      title: extractFirstLine(block.content),
      issueLastUpdated: Date.now(),
      isDone: block.marker === 'DONE',
    };

    // If time is specified, use dueWithTime, otherwise use dueDay
    if (block.scheduledDateTime) {
      return {
        ...baseData,
        issueWasUpdated: false,
        dueWithTime: block.scheduledDateTime,
        dueDay: undefined, // Clear dueDay when time is set
      };
    } else if (block.scheduledDate) {
      // Check if scheduled date is in the past (overdue)
      if (block.scheduledDate < todayStr) {
        LogseqLog.debug('[LOGSEQ OVERDUE] Detected overdue task:', {
          blockContent: block.content,
          scheduledDate: block.scheduledDate,
          today: todayStr,
        });
        // Don't import old dates - let them be treated as overdue in SuperProd
        return {
          ...baseData,
          issueWasUpdated: true, // Prevent auto-sync of this old date back to Logseq
          dueDay: undefined,
          dueWithTime: undefined,
        };
      }

      return {
        ...baseData,
        issueWasUpdated: false,
        dueDay: block.scheduledDate,
        dueWithTime: undefined, // Clear dueWithTime when only date is set
      };
    } else {
      return {
        ...baseData,
        issueWasUpdated: false,
        dueDay: undefined, // Clear dueDay when no SCHEDULED
        dueWithTime: undefined, // Clear dueWithTime when no SCHEDULED
      };
    }
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

    // Skip if this block is currently being written to (write-mutex)
    // This prevents race conditions where polling sees stale data during a write
    if (this._blocksBeingWritten.has(task.issueId as string)) {
      LogseqLog.debug('[LOGSEQ POLL] Skipping - block is being written:', task.issueId);
      return null;
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    if (!cfg) {
      throw new Error('No config found for issueProviderId');
    }

    const block = await firstValueFrom(
      this._logseqApiService.getBlockByUuid$(task.issueId as string, cfg),
    );
    if (!block) {
      return null;
    }

    const blockTitle = extractFirstLine(block.content);
    // Note: We don't compare titles directly anymore.
    // Title changes in Logseq are detected via content hash change.
    // This allows users to rename tasks in SuperProd without triggering updates.

    // Check for marker discrepancy (triggers discrepancy dialog, but NOT "updated" badge)
    // Get current task ID to check active status discrepancy
    const currentTaskId = this._taskService.currentTaskId();
    const isTaskActive = currentTaskId === task.id;
    const isBlockActive = block.marker === 'NOW' || block.marker === 'DOING';
    const isBlockDone = block.marker === 'DONE';

    // Detect all marker discrepancies:
    // 1. DONE status differs
    // 2. Active status differs (block is active but task not, or vice versa)
    const isDoneDiscrepancy = isBlockDone !== task.isDone;
    const isActiveDiscrepancy = !task.isDone && isBlockActive !== isTaskActive;
    const isMarkerDiscrepancy = isDoneDiscrepancy || isActiveDiscrepancy;

    // Read stored sync data from :SP: drawer in block content
    const spDrawerData = extractSpDrawerData(block.content);
    const currentHash = calculateContentHash(block.content);

    // Initialize :SP: drawer if it doesn't exist yet
    // This ensures we can detect future changes
    // Do this BEFORE checking for updates so it always happens
    if (spDrawerData.contentHash === null) {
      LogseqLog.debug('[LOGSEQ SP DRAWER] Initializing drawer for task:', task.id);
      await this.updateSpDrawer(task.issueId as string, task.issueProviderId);
    }

    // Check for content changes using drawer data
    // Only consider it changed if we have a stored hash AND it differs from current
    // If no stored hash exists, we can't detect content changes yet
    const isContentChanged =
      spDrawerData.contentHash !== null && spDrawerData.contentHash !== currentHash;

    // Check if scheduled date/time changed
    const blockScheduledDate = extractScheduledDate(block.content);
    const blockScheduledDateTime = extractScheduledDateTime(block.content);

    // Only detect date/time changes if block content actually changed (hash differs)
    // This prevents overwriting SuperProd changes before they're synced to Logseq
    // If hash is same or no drawer exists, SuperProd has authority
    const isDueDateChanged =
      isContentChanged && (blockScheduledDate ?? null) !== (task.dueDay ?? null);
    const isDueTimeChanged =
      isContentChanged && (blockScheduledDateTime ?? null) !== (task.dueWithTime ?? null);

    // Determine if this is a content change (should mark as "updated")
    // vs just a marker discrepancy (should show dialog but not mark as "updated")
    const hasContentChange = isContentChanged || isDueDateChanged || isDueTimeChanged;

    LogseqLog.debug('[LOGSEQ UPDATE CHECK]', {
      taskId: task.id,
      taskTitle: task.title,
      isMarkerDiscrepancy,
      isDoneDiscrepancy,
      isActiveDiscrepancy,
      isTaskActive,
      isBlockActive,
      hasContentChange,
      isContentChanged,
      isDueDateChanged,
      isDueTimeChanged,
      blockTitle,
      blockMarker: block.marker,
      spDrawerData,
      currentHash,
      taskIsDone: task.isDone,
      blockScheduledDate,
      taskDueDay: task.dueDay,
      blockScheduledDateTime,
      taskDueWithTime: task.dueWithTime,
      blockContent: block.content,
    });

    // Emit marker discrepancies to Subject for dialog handling
    // This is done separately from content changes to allow the dialog to handle them
    if (isMarkerDiscrepancy) {
      let discrepancyType: DiscrepancyType;
      if (isDoneDiscrepancy) {
        discrepancyType = isBlockDone
          ? 'LOGSEQ_DONE_SUPERPROD_NOT_DONE'
          : 'SUPERPROD_DONE_LOGSEQ_NOT_DONE';
      } else {
        // isActiveDiscrepancy
        discrepancyType = isBlockActive
          ? 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE'
          : 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE';
      }

      LogseqLog.debug('[LOGSEQ DISCREPANCY] Emitting:', {
        taskId: task.id,
        discrepancyType,
      });

      this.discrepancies$.next({
        task,
        block,
        discrepancyType,
      });
    }

    // Trigger update if there's a marker discrepancy OR content change
    // - Marker discrepancy: triggers discrepancy dialog (emitted above)
    // - Content change: triggers "updated" badge
    if (isMarkerDiscrepancy || hasContentChange) {
      // Update :SP: drawer with new hash so next poll won't trigger false positive
      if (hasContentChange) {
        await this.updateSpDrawer(task.issueId as string, task.issueProviderId);
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { title, isDone, ...taskDataWithoutTitleAndDone } = this.getAddTaskData(
        mapBlockToIssueReduced(block),
      );

      // For marker discrepancy without content change, we need to force an update
      // by changing issueLastUpdated. Otherwise, if all task properties are the same,
      // no update action is dispatched and the discrepancy dialog won't appear.
      const forceUpdate = isMarkerDiscrepancy && !hasContentChange;

      return {
        taskChanges: {
          // Don't update title - it's only set on task creation
          // Users can rename tasks in SuperProd without it being overwritten
          ...taskDataWithoutTitleAndDone,
          // Don't update isDone for marker discrepancies - let the discrepancy dialog handle it
          // Only update isDone for content changes when there's no DONE discrepancy
          ...(hasContentChange && !isDoneDiscrepancy ? { isDone } : {}),
          // Force update by setting issueLastUpdated to now if only marker changed
          ...(forceUpdate ? { issueLastUpdated: Date.now() } : {}),
          // Only mark as "updated" for content changes, not marker discrepancies
          issueWasUpdated: hasContentChange,
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
    if (tasks.length === 0) {
      return [];
    }

    // All tasks should have the same issueProviderId
    const issueProviderId = tasks[0].issueProviderId;
    if (!issueProviderId) {
      return [];
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg) {
      return [];
    }

    // Filter out tasks that are being written (write-mutex)
    const tasksToFetch = tasks.filter((task) => {
      if (this._blocksBeingWritten.has(task.issueId as string)) {
        LogseqLog.debug('[LOGSEQ POLL] Skipping - block is being written:', task.issueId);
        return false;
      }
      return task.issueId;
    });

    if (tasksToFetch.length === 0) {
      return [];
    }

    // Batch fetch all blocks in a single HTTP request
    const uuids = tasksToFetch.map((task) => task.issueId as string);
    const blocks = await firstValueFrom(
      this._logseqApiService.getBlocksByUuids$(uuids, cfg).pipe(first()),
    );

    if (!blocks || blocks.length === 0) {
      return [];
    }

    // Create a map for quick block lookup
    const blockMap = new Map(blocks.map((block) => [block.uuid, block]));

    // Process each task with its fetched block
    const results: { task: Task; taskChanges: Partial<Task>; issue: LogseqBlock }[] = [];

    for (const task of tasksToFetch) {
      const block = blockMap.get(task.issueId as string);
      if (!block) {
        continue;
      }

      const refreshData = await this._processBlockForTask(task, block, cfg);
      if (refreshData) {
        results.push({
          task,
          taskChanges: refreshData.taskChanges,
          issue: refreshData.issue,
        });
      }
    }

    return results;
  }

  /**
   * Process a pre-fetched block to detect changes for a task.
   * Extracted from getFreshDataForIssueTask to support batch processing.
   */
  private async _processBlockForTask(
    task: Task,
    block: LogseqBlock,
    cfg: LogseqCfg,
  ): Promise<{
    taskChanges: Partial<Task>;
    issue: LogseqBlock;
    issueTitle: string;
  } | null> {
    const blockTitle = extractFirstLine(block.content);

    // Check for marker discrepancy
    const currentTaskId = this._taskService.currentTaskId();
    const isTaskActive = currentTaskId === task.id;
    const isBlockActive = block.marker === 'NOW' || block.marker === 'DOING';
    const isBlockDone = block.marker === 'DONE';

    const isDoneDiscrepancy = isBlockDone !== task.isDone;
    const isActiveDiscrepancy = !task.isDone && isBlockActive !== isTaskActive;
    const isMarkerDiscrepancy = isDoneDiscrepancy || isActiveDiscrepancy;

    // Read stored sync data from :SP: drawer
    const spDrawerData = extractSpDrawerData(block.content);
    const currentHash = calculateContentHash(block.content);

    // Initialize :SP: drawer if it doesn't exist yet
    if (spDrawerData.contentHash === null) {
      LogseqLog.debug('[LOGSEQ SP DRAWER] Initializing drawer for task:', task.id);
      await this._updateSpDrawerWithCfg(task.issueId as string, cfg);
    }

    // Check for content changes
    const isContentChanged =
      spDrawerData.contentHash !== null && spDrawerData.contentHash !== currentHash;

    // Check for scheduled date/time changes
    const blockScheduledDate = extractScheduledDate(block.content);
    const blockScheduledDateTime = extractScheduledDateTime(block.content);

    const isDueDateChanged =
      isContentChanged && (blockScheduledDate ?? null) !== (task.dueDay ?? null);
    const isDueTimeChanged =
      isContentChanged && (blockScheduledDateTime ?? null) !== (task.dueWithTime ?? null);

    const hasContentChange = isContentChanged || isDueDateChanged || isDueTimeChanged;

    LogseqLog.debug('[LOGSEQ UPDATE CHECK]', {
      taskId: task.id,
      taskTitle: task.title,
      isMarkerDiscrepancy,
      hasContentChange,
      blockTitle,
      blockMarker: block.marker,
    });

    // Emit marker discrepancies
    if (isMarkerDiscrepancy) {
      let discrepancyType: DiscrepancyType;
      if (isDoneDiscrepancy) {
        discrepancyType = isBlockDone
          ? 'LOGSEQ_DONE_SUPERPROD_NOT_DONE'
          : 'SUPERPROD_DONE_LOGSEQ_NOT_DONE';
      } else {
        discrepancyType = isBlockActive
          ? 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE'
          : 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE';
      }

      this.discrepancies$.next({
        task,
        block,
        discrepancyType,
      });
    }

    if (isMarkerDiscrepancy || hasContentChange) {
      if (hasContentChange) {
        await this._updateSpDrawerWithCfg(task.issueId as string, cfg);
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { title, isDone, ...taskDataWithoutTitleAndDone } = this.getAddTaskData(
        mapBlockToIssueReduced(block),
      );

      const forceUpdate = isMarkerDiscrepancy && !hasContentChange;

      return {
        taskChanges: {
          ...taskDataWithoutTitleAndDone,
          ...(hasContentChange && !isDoneDiscrepancy ? { isDone } : {}),
          ...(forceUpdate ? { issueLastUpdated: Date.now() } : {}),
          issueWasUpdated: hasContentChange,
        },
        issue: block,
        issueTitle: extractFirstLine(block.content),
      };
    }

    return null;
  }

  /**
   * Update :SP: drawer with config already available (for batch processing)
   */
  private async _updateSpDrawerWithCfg(blockUuid: string, cfg: LogseqCfg): Promise<void> {
    const block = await firstValueFrom(
      this._logseqApiService.getBlockByUuid$(blockUuid, cfg),
    );
    if (!block) {
      return;
    }

    const contentHash = calculateContentHash(block.content);
    const timestamp = Date.now();
    const updatedContent = updateSpDrawerInContent(block.content, timestamp, contentHash);

    await firstValueFrom(
      this._logseqApiService.updateBlock$(block.uuid, updatedContent, cfg),
    );

    LogseqLog.debug('[LOGSEQ SP DRAWER] Updated:', {
      blockUuid,
      timestamp,
      contentHash,
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
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg) {
      return [];
    }

    const children = await firstValueFrom(
      this._logseqApiService.getBlockChildren$(blockUuid, cfg),
    );
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
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg || !this.isEnabled(cfg)) {
      return [];
    }

    // Use custom query from config or default query
    const query = cfg.queryFilter || DEFAULT_LOGSEQ_CFG.queryFilter;

    const blocks = await firstValueFrom(
      this._logseqApiService.queryBlocks$(cfg, query).pipe(first()),
    );

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
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg) {
      return;
    }

    // Set write-mutex to prevent discrepancy detection during write
    this._blocksBeingWritten.add(blockUuid);

    try {
      const block = await this.getById(blockUuid, issueProviderId);

      // Update marker in content
      const updatedContent = block.content.replace(LOGSEQ_MARKER_REGEX, `${newMarker} `);

      await firstValueFrom(
        this._logseqApiService.updateBlock$(block.uuid, updatedContent, cfg),
      );
    } finally {
      // Clear write-mutex after write completes
      this._blocksBeingWritten.delete(blockUuid);
    }
  }

  async updateIssueFromTask(task: Task): Promise<void> {
    if (!task.issueId || !task.issueProviderId) {
      return;
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    if (!cfg) {
      return;
    }

    // Set write-mutex to prevent discrepancy detection during write
    this._blocksBeingWritten.add(task.issueId as string);

    try {
      const block = await this.getById(task.issueId as string, task.issueProviderId);
      const todayStr = getDbDateStr();

      let updatedContent = block.content;
      let hasChanges = false;

      // Update marker if task done status changed
      if (task.isDone && block.marker !== 'DONE') {
        updatedContent = updatedContent.replace(LOGSEQ_MARKER_REGEX, 'DONE ');
        hasChanges = true;
      }

      // Update SCHEDULED - use dueWithTime if available, otherwise dueDay
      const currentScheduledDate = extractScheduledDate(block.content);
      const currentScheduledDateTime = extractScheduledDateTime(block.content);

      // Determine what should be in Logseq
      let shouldUpdateScheduled = false;

      if (task.dueWithTime) {
        // Task has time - check if it differs from current
        if (currentScheduledDateTime !== task.dueWithTime) {
          updatedContent = updateScheduledInContent(updatedContent, task.dueWithTime);
          shouldUpdateScheduled = true;
        }
      } else if (task.dueDay) {
        // Smart Reschedule: If task was overdue in Logseq and is now set to today
        // Update SCHEDULED in Logseq to today as well
        const wasOverdueInLogseq =
          currentScheduledDate !== null && currentScheduledDate < todayStr;
        const isNowScheduledForToday = task.dueDay === todayStr;

        if (wasOverdueInLogseq && isNowScheduledForToday) {
          LogseqLog.debug('[LOGSEQ SMART RESCHEDULE] Updating overdue task to today:', {
            taskTitle: task.title,
            oldScheduledDate: currentScheduledDate,
            newScheduledDate: todayStr,
          });
          updatedContent = updateScheduledInContent(updatedContent, todayStr);
          shouldUpdateScheduled = true;
        }
        // Normal case: Task has only date - check if it differs from current
        else if (
          currentScheduledDate !== task.dueDay ||
          currentScheduledDateTime !== null
        ) {
          updatedContent = updateScheduledInContent(updatedContent, task.dueDay);
          shouldUpdateScheduled = true;
        }
      } else {
        // Task has no due date - remove SCHEDULED if present
        if (currentScheduledDate !== null || currentScheduledDateTime !== null) {
          updatedContent = updateScheduledInContent(updatedContent, null);
          shouldUpdateScheduled = true;
        }
      }

      if (shouldUpdateScheduled) {
        hasChanges = true;
      }

      if (hasChanges) {
        await firstValueFrom(
          this._logseqApiService.updateBlock$(block.uuid, updatedContent, cfg),
        );

        // Update :SP: drawer with new sync data
        await this.updateSpDrawer(task.issueId as string, task.issueProviderId);
      }
    } finally {
      // Clear write-mutex after write completes
      this._blocksBeingWritten.delete(task.issueId as string);
    }
  }

  /**
   * Update the :SP: drawer in a block with current sync timestamp and content hash
   * This should be called after any sync operation to track the synced state
   */
  async updateSpDrawer(blockUuid: string, issueProviderId: string): Promise<void> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg) {
      return;
    }

    const block = await firstValueFrom(
      this._logseqApiService.getBlockByUuid$(blockUuid, cfg),
    );
    if (!block) {
      return;
    }

    // Calculate hash without the :SP: drawer to avoid self-referential hash
    const contentHash = calculateContentHash(block.content);
    const timestamp = Date.now();

    // Update the block content with new :SP: drawer
    const updatedContent = updateSpDrawerInContent(block.content, timestamp, contentHash);

    await firstValueFrom(
      this._logseqApiService.updateBlock$(block.uuid, updatedContent, cfg),
    );

    LogseqLog.debug('[LOGSEQ SP DRAWER] Updated:', {
      blockUuid,
      timestamp,
      contentHash,
    });
  }

  private _getCfgOnce$(issueProviderId: string): Observable<LogseqCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, LOGSEQ_TYPE);
  }
}
