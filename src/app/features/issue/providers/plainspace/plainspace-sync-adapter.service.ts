import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from '../../two-way-sync/issue-sync.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService } from './plainspace-api.service';

/**
 * Push fields, written via PATCH /tasks/:id:
 * - `isDone` → `done`
 * - `title` → `title` (SP rename → Plainspace item text)
 * - `dueWithTime` → `scheduledAt` (SP scheduled time → Plainspace). SP stores an
 *   epoch-ms number; Plainspace wants an ISO instant, or null to unschedule.
 *   Plainspace's own reminder sweep then fires it for the team.
 *
 * Direction is `pushOnly` for all three: the reverse direction (Plainspace → SP)
 * is handled by issue-update polling (getFreshDataForIssueTask applies
 * getAddTaskData, which already carries title/isDone/scheduledAt), not this
 * adapter.
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
    defaultDirection: 'pushOnly',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
  {
    taskField: 'dueWithTime',
    issueField: 'scheduledAt',
    defaultDirection: 'pushOnly',
    toIssueValue: (taskValue: unknown): string | null =>
      typeof taskValue === 'number' ? new Date(taskValue).toISOString() : null,
    toTaskValue: (issueValue: unknown): number | undefined =>
      typeof issueValue === 'string' ? new Date(issueValue).getTime() : undefined,
  },
];

/**
 * Two-way sync adapter for Plainspace: pushes a task's done state and scheduled
 * time back to Plainspace when it is completed/reopened or (re)scheduled in Super
 * Productivity. Registered for the `PLAINSPACE` issue type in
 * IssueTwoWaySyncEffects.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceSyncAdapterService implements IssueSyncAdapter<PlainspaceCfg> {
  private readonly _api = inject(PlainspaceApiService);

  getFieldMappings(): FieldMapping[] {
    return PLAINSPACE_FIELD_MAPPINGS;
  }

  getSyncConfig(_cfg: PlainspaceCfg): FieldSyncConfig {
    return { isDone: 'pushOnly', title: 'pushOnly', dueWithTime: 'pushOnly' };
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
    // `changes` is keyed by issue field (toPush from the effect). Collapse done
    // and scheduled-time changes into a single PATCH.
    const fields: { done?: boolean; title?: string; scheduledAt?: string | null } = {};
    if ('isDone' in changes) {
      fields.done = !!changes['isDone'];
    }
    if ('title' in changes) {
      fields.title = (changes['title'] ?? '') as string;
    }
    if ('scheduledAt' in changes) {
      fields.scheduledAt = (changes['scheduledAt'] ?? null) as string | null;
    }
    if (Object.keys(fields).length === 0) {
      return;
    }
    await firstValueFrom(this._api.patchTask$(issueId, fields, cfg));
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    // Every push field needs a baseline here, else computePushDecisions skips it
    // as 'no-baseline' and nothing ever pushes.
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
