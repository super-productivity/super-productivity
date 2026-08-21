import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import {
  FieldMapping,
  FieldMappingContext,
  FieldSyncConfig,
} from '../../two-way-sync/issue-sync.model';
import { OutlookTasksCfg } from './outlook-tasks.model';
import { OutlookTasksClientService } from './outlook-tasks-client.service';
import { OutlookTaskStatus } from './outlook-tasks-issue.model';

const OUTLOOK_TASKS_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'status',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown, _ctx: FieldMappingContext): string =>
      taskValue ? OutlookTaskStatus.COMPLETED : OutlookTaskStatus.NOT_STARTED,
    toTaskValue: (issueValue: unknown, _ctx: FieldMappingContext): boolean =>
      issueValue === OutlookTaskStatus.COMPLETED,
  },
  {
    taskField: 'title',
    issueField: 'title',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown, _ctx: FieldMappingContext): string =>
      typeof taskValue === 'string' ? taskValue : '',
    toTaskValue: (issueValue: unknown, _ctx: FieldMappingContext): string =>
      typeof issueValue === 'string' ? issueValue : '',
  },
  {
    taskField: 'notes',
    issueField: 'body',
    defaultDirection: 'off',
    toIssueValue: (taskValue: unknown, _ctx: FieldMappingContext): string =>
      typeof taskValue === 'string' ? taskValue : '',
    toTaskValue: (issueValue: unknown, _ctx: FieldMappingContext): string => {
      if (
        typeof issueValue === 'object' &&
        issueValue !== null &&
        'content' in issueValue
      ) {
        return typeof (issueValue as Record<string, unknown>).content === 'string'
          ? ((issueValue as Record<string, unknown>).content as string)
          : '';
      }
      return typeof issueValue === 'string' ? issueValue : '';
    },
  },
];

@Injectable({
  providedIn: 'root',
})
export class OutlookTasksSyncAdapterService implements IssueSyncAdapter<OutlookTasksCfg> {
  private readonly _clientService = inject(OutlookTasksClientService);

  getFieldMappings(): FieldMapping[] {
    return OUTLOOK_TASKS_FIELD_MAPPINGS;
  }

  getSyncConfig(cfg: OutlookTasksCfg): FieldSyncConfig {
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

  async fetchIssue(
    issueId: string,
    cfg: OutlookTasksCfg,
  ): Promise<Record<string, unknown>> {
    const issue = await firstValueFrom(this._clientService.getById$(issueId, cfg));
    // OutlookTasksIssue is already a plain object; spread to satisfy Record<string, unknown>.
    return { ...issue };
  }

  async pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: OutlookTasksCfg,
  ): Promise<void> {
    const updates: { title?: string; status?: string; body?: string } = {};
    if (typeof changes['title'] === 'string') {
      updates.title = changes['title'];
    }
    if (typeof changes['status'] === 'string') {
      updates.status = changes['status'];
    }
    if (typeof changes['body'] === 'string') {
      updates.body = changes['body'];
    }
    await firstValueFrom(this._clientService.updateTask$(cfg, issueId, updates));
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    return {
      status: issue['status'],
      title: issue['title'],
      body: issue['body'],
    };
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    const lastModified = issue['lastModifiedDateTime'];
    return typeof lastModified === 'string' ? new Date(lastModified).getTime() : 0;
  }
}
