import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from '../../two-way-sync/issue-sync.model';
import { CaldavCfg } from './caldav.model';
import { CaldavClientService } from './caldav-client.service';
import { taskIdToCaldavUid } from './caldav-uid.util';

const CALDAV_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'completed',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown): boolean => !!taskValue,
    toTaskValue: (issueValue: unknown): boolean => !!issueValue,
  },
  {
    taskField: 'title',
    issueField: 'summary',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
  {
    taskField: 'notes',
    issueField: 'note',
    defaultDirection: 'off',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
];

@Injectable({
  providedIn: 'root',
})
export class CaldavSyncAdapterService implements IssueSyncAdapter<CaldavCfg> {
  private readonly _caldavClientService = inject(CaldavClientService);

  getFieldMappings(): FieldMapping[] {
    return CALDAV_FIELD_MAPPINGS;
  }

  getSyncConfig(cfg: CaldavCfg): FieldSyncConfig {
    const twoWay = cfg.twoWaySync;
    if (!twoWay) {
      return {};
    }
    return {
      isDone: twoWay.isDone,
      title: twoWay.title,
      notes: twoWay.notes,
    };
  }

  async fetchIssue(issueId: string, cfg: CaldavCfg): Promise<Record<string, unknown>> {
    const issue = await firstValueFrom(this._caldavClientService.getById$(issueId, cfg));
    return issue as unknown as Record<string, unknown>;
  }

  async pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: CaldavCfg,
  ): Promise<void> {
    await firstValueFrom(
      this._caldavClientService.updateFields$(
        cfg,
        issueId,
        changes as { completed?: boolean; summary?: string; note?: string },
      ),
    );
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    return {
      completed: issue['completed'],
      summary: issue['summary'],
      note: issue['note'],
    };
  }

  /**
   * Uploads a new task as a VTODO (via the generic `autoCreateIssueOnTaskAdd$`
   * effect, only when the user opted in — see `_hasAutoCreateEnabled`). The UID
   * derives from the task id, so a repeated create resolves to the same VTODO.
   */
  async createIssue(
    title: string,
    cfg: CaldavCfg,
    ctx?: { taskId: string },
  ): Promise<{ issueId: string; issueData: Record<string, unknown> }> {
    if (!ctx?.taskId) {
      throw new Error('CalDAV createIssue needs the task id');
    }
    const issue = await firstValueFrom(
      this._caldavClientService.createTask$(cfg, {
        uid: taskIdToCaldavUid(ctx.taskId),
        summary: title,
      }),
    );
    return {
      issueId: issue.id,
      issueData: issue as unknown as Record<string, unknown>,
    };
  }

  /**
   * Deletes the VTODO when its SP task is deleted (via the generic
   * `deleteIssueOnTaskDelete$` effects, after the undo window) — but only when
   * the user opted in. The generic remote-delete path has no gate of its own, so
   * without this check implementing the hook would delete server data for every
   * existing CalDAV user (#10096).
   */
  async deleteIssue(issueId: string, cfg: CaldavCfg): Promise<void> {
    if (!cfg.twoWaySync?.deleteOnServer) {
      return;
    }
    await firstValueFrom(this._caldavClientService.deleteTask$(cfg, issueId));
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    return issue['etag_hash'] as number;
  }
}
