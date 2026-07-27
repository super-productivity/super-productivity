import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from '../../two-way-sync/issue-sync.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService } from './plainspace-api.service';

/**
 * Field mappings between Super Productivity and Plainspace:
 * - `isDone` → `done`
 * - `title` → `title`
 * - `dueWithTime` → `scheduledAt`
 *
 * Completion is the only field written back. Title and schedule are pulled from
 * Plainspace by issue-update polling.
 *
 * `dueDay` (date-only scheduling, no time) is intentionally NOT mapped: Plainspace
 * `scheduledAt` always carries a time, so mapping a day-only task would fabricate
 * a time-of-day. There is no separate day field on Plainspace to clear, so no
 * `mutuallyExclusive` entry is needed.
 */
const PLAINSPACE_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'isDone',
    defaultDirection: 'pushOnly',
    toIssueValue: (taskValue: unknown): boolean => !!taskValue,
    toTaskValue: (issueValue: unknown): boolean => !!issueValue,
  },
  {
    taskField: 'title',
    issueField: 'title',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
  {
    taskField: 'dueWithTime',
    issueField: 'scheduledAt',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown): string | null =>
      typeof taskValue === 'number' ? new Date(taskValue).toISOString() : null,
    toTaskValue: (issueValue: unknown): number | undefined =>
      typeof issueValue === 'string' ? new Date(issueValue).getTime() : undefined,
  },
];

/**
 * Two-way sync adapter for Plainspace: writes completion changes back and leaves
 * Plainspace-owned title and schedule data to the polling path.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceSyncAdapterService implements IssueSyncAdapter<PlainspaceCfg> {
  private readonly _api = inject(PlainspaceApiService);

  getFieldMappings(): FieldMapping[] {
    return PLAINSPACE_FIELD_MAPPINGS;
  }

  getSyncConfig(_cfg: PlainspaceCfg): FieldSyncConfig {
    return { isDone: 'pushOnly', title: 'pullOnly', dueWithTime: 'pullOnly' };
  }

  /**
   * Creates the task in Plainspace when it is first added to a Plainspace-backed
   * project (via the generic `autoCreateIssueOnTaskAdd$` effect), then hands the
   * created issue back so the effect can link it and seed the two-way-sync
   * baseline. No `issueNumber`: Plainspace tasks have no numeric id, so the SP
   * title stays as typed (no `#123` prefix).
   */
  async createIssue(
    title: string,
    cfg: PlainspaceCfg,
  ): Promise<{ issueId: string; issueData: Record<string, unknown> }> {
    const issue = await firstValueFrom(this._api.createTask$(title, cfg));
    return {
      issueId: issue.id,
      issueData: issue as Record<string, unknown>,
    };
  }

  async fetchIssue(
    issueId: string,
    cfg: PlainspaceCfg,
  ): Promise<Record<string, unknown>> {
    const issue = await firstValueFrom(this._api.getById$(issueId, cfg));
    return (issue ?? {}) as unknown as Record<string, unknown>;
  }

  async pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: PlainspaceCfg,
  ): Promise<void> {
    if (!('isDone' in changes)) {
      return;
    }
    const done = !!changes['isDone'];
    const updated = await firstValueFrom(this._api.patchTask$(issueId, { done }, cfg));
    if (!updated || updated.id !== issueId || updated.isDone !== done) {
      throw new Error('Plainspace completion update failed');
    }
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    // Completion needs a push baseline; title and schedule remain in the same
    // remote baseline so polling can identify provider-owned changes.
    return {
      isDone: issue['isDone'],
      title: issue['title'],
      scheduledAt: issue['scheduledAt'],
    };
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    const updatedAt = issue['updatedAt'];
    return updatedAt ? new Date(updatedAt as string).getTime() : 0;
  }
}
