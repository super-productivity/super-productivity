import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from '../../two-way-sync/issue-sync.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService } from './plainspace-api.service';

/**
 * Push-only fields, written via PATCH /tasks/:id:
 * - `isDone` → `done`
 * - `dueWithTime` → `scheduledAt` (SP scheduled time → Plainspace). SP stores an
 *   epoch-ms number; Plainspace wants an ISO instant, or null to unschedule.
 *   Plainspace's own reminder sweep then fires it for the team.
 *
 * `dueDay` (date-only scheduling, no time) is intentionally NOT mapped: Plainspace
 * `scheduledAt` always carries a time, so mapping a day-only task would fabricate
 * a time-of-day. There is no separate day field on Plainspace to clear, so no
 * `mutuallyExclusive` entry is needed. Changes the other way (Plainspace → SP) go
 * through issue-update polling (getFreshDataForIssueTask), not this adapter.
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
    return { isDone: 'pushOnly', dueWithTime: 'pushOnly' };
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
    const fields: { done?: boolean; scheduledAt?: string | null } = {};
    if ('isDone' in changes) {
      fields.done = !!changes['isDone'];
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
    // Both push-only fields need a baseline here, else computePushDecisions skips
    // them as 'no-baseline' and nothing ever pushes.
    return { isDone: issue['isDone'], scheduledAt: issue['scheduledAt'] };
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    const updatedAt = issue['updatedAt'];
    return updatedAt ? new Date(updatedAt as string).getTime() : 0;
  }
}
