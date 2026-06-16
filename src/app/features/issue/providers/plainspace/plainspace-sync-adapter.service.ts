import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from '../../two-way-sync/issue-sync.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService } from './plainspace-api.service';

/**
 * Only the done state is writable through the Plainspace integration API
 * (PATCH /tasks/:id { done }), so `isDone` is the single pushed field. Title and
 * done changes coming the other way (Plainspace -> SP) are handled by the normal
 * issue-update polling (getFreshDataForIssueTask), not this adapter.
 */
const PLAINSPACE_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'isDone',
    defaultDirection: 'pushOnly',
    toIssueValue: (taskValue: unknown): boolean => !!taskValue,
    toTaskValue: (issueValue: unknown): boolean => !!issueValue,
  },
];

/**
 * Two-way sync adapter for Plainspace: pushes a task's done state back to
 * Plainspace when it is completed/reopened in Super Productivity. Registered for
 * the `PLAINSPACE` issue type in IssueTwoWaySyncEffects.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceSyncAdapterService implements IssueSyncAdapter<PlainspaceCfg> {
  private readonly _api = inject(PlainspaceApiService);

  getFieldMappings(): FieldMapping[] {
    return PLAINSPACE_FIELD_MAPPINGS;
  }

  getSyncConfig(_cfg: PlainspaceCfg): FieldSyncConfig {
    return { isDone: 'pushOnly' };
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
    if ('isDone' in changes) {
      await firstValueFrom(this._api.setTaskDone$(issueId, !!changes['isDone'], cfg));
    }
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    return { isDone: issue['isDone'] };
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    const updatedAt = issue['updatedAt'];
    return updatedAt ? new Date(updatedAt as string).getTime() : 0;
  }
}
