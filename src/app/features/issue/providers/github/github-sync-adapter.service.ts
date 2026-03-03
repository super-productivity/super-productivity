import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import {
  FieldMapping,
  FieldMappingContext,
  FieldSyncConfig,
} from '../../two-way-sync/issue-sync.model';
import { GithubCfg } from './github.model';
import { GithubApiService } from './github-api.service';

const GITHUB_FIELD_MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'state',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown): string => (taskValue ? 'closed' : 'open'),
    toTaskValue: (issueValue: unknown): boolean => issueValue === 'closed',
  },
  {
    taskField: 'title',
    issueField: 'title',
    defaultDirection: 'pullOnly',
    toIssueValue: (taskValue: unknown, ctx: FieldMappingContext): string => {
      const str = taskValue as string;
      const prefix = `#${ctx.issueNumber} `;
      return str.startsWith(prefix) ? str.slice(prefix.length) : str;
    },
    toTaskValue: (issueValue: unknown, ctx: FieldMappingContext): string =>
      `#${ctx.issueNumber} ${issueValue}`,
  },
  {
    taskField: 'notes',
    issueField: 'body',
    defaultDirection: 'off',
    toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
    toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
  },
];

@Injectable({
  providedIn: 'root',
})
export class GithubSyncAdapterService implements IssueSyncAdapter<GithubCfg> {
  private readonly _githubApiService = inject(GithubApiService);

  getFieldMappings(): FieldMapping[] {
    return GITHUB_FIELD_MAPPINGS;
  }

  getSyncConfig(cfg: GithubCfg): FieldSyncConfig {
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

  async fetchIssue(issueId: string, cfg: GithubCfg): Promise<Record<string, unknown>> {
    const issue = await firstValueFrom(
      this._githubApiService.getById$(+issueId, cfg, false),
    );
    return issue as unknown as Record<string, unknown>;
  }

  async pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: GithubCfg,
  ): Promise<void> {
    await firstValueFrom(
      this._githubApiService.updateIssue$(
        +issueId,
        changes as { state?: string; title?: string; body?: string },
        cfg,
      ),
    );
  }

  async createIssue(
    title: string,
    cfg: GithubCfg,
  ): Promise<{
    issueId: string;
    issueNumber: number;
    issueData: Record<string, unknown>;
  }> {
    const issue = await firstValueFrom(this._githubApiService.createIssue$(title, cfg));
    return {
      issueId: issue.number.toString(),
      issueNumber: issue.number,
      issueData: issue as unknown as Record<string, unknown>,
    };
  }

  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    return {
      state: issue['state'],
      title: issue['title'],
      body: issue['body'],
    };
  }
}
