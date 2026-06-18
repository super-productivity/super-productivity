import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from '../../two-way-sync/issue-sync.model';
import { BasecampApiService } from './basecamp-api.service';
import { BasecampCfg } from './basecamp.model';
import { BasecampTodo } from './basecamp-issue.model';

const BASECAMP_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'completed',
    defaultDirection: 'pushOnly',
    toIssueValue: (taskValue: unknown): boolean => !!taskValue,
    toTaskValue: (issueValue: unknown): boolean => !!issueValue,
  },
];

@Injectable({ providedIn: 'root' })
export class BasecampSyncAdapterService implements IssueSyncAdapter<BasecampCfg> {
  private readonly _basecampApiService = inject(BasecampApiService);

  getFieldMappings(): FieldMapping[] {
    return BASECAMP_FIELD_MAPPINGS;
  }

  getSyncConfig(_cfg: BasecampCfg): FieldSyncConfig {
    return {};
  }

  async fetchIssue(issueId: string, cfg: BasecampCfg): Promise<Record<string, unknown>> {
    const todo = await firstValueFrom(this._basecampApiService.getTodo$(issueId, cfg));
    return todo as unknown as Record<string, unknown>;
  }

  async pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: BasecampCfg,
  ): Promise<void> {
    if (!('completed' in changes)) {
      return;
    }
    if (changes['completed']) {
      await firstValueFrom(this._basecampApiService.completeTodo$(issueId, cfg));
    } else {
      await firstValueFrom(this._basecampApiService.uncompleteTodo$(issueId, cfg));
    }
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    return { completed: !!issue['completed'] };
  }

  getIssueLastUpdated(issue: Record<string, unknown>): number {
    const todo = issue as unknown as BasecampTodo;
    const lastUpdated = todo.updated_at || todo.created_at;
    return lastUpdated ? new Date(lastUpdated).getTime() : 0;
  }
}
