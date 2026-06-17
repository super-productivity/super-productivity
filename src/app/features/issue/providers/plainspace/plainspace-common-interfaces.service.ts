import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { PLAINSPACE_POLL_INTERVAL } from './plainspace.const';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceSyncAdapterService } from './plainspace-sync-adapter.service';
import { PlainspaceIssue } from './plainspace-issue.model';

@Injectable({
  providedIn: 'root',
})
export class PlainspaceCommonInterfacesService extends BaseIssueProviderService<PlainspaceCfg> {
  private readonly _plainspaceApiService = inject(PlainspaceApiService);
  private readonly _syncAdapter = inject(PlainspaceSyncAdapterService);

  readonly providerKey = 'PLAINSPACE' as const;
  readonly pollInterval: number = PLAINSPACE_POLL_INTERVAL;

  isEnabled(cfg: PlainspaceCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.host && !!cfg.spaceId && !!cfg.token;
  }

  testConnection(cfg: PlainspaceCfg): Promise<boolean> {
    return firstValueFrom(
      this._plainspaceApiService.getMe$(cfg).pipe(map((res) => !!res)),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    // The canonical link (`{origin}/{slug}/item/{id}`) comes from the task's own
    // `url`; fall back to the host root if the task can't be fetched (offline).
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((cfg) =>
          this._plainspaceApiService
            .getById$(String(issueId), cfg)
            .pipe(map((issue) => issue?.url || `${cfg.host}`)),
        ),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(
    issue: PlainspaceIssue,
  ): Partial<Readonly<TaskCopy>> & { title: string } {
    // Import Plainspace's `scheduledAt` as the SP task's scheduled time so it
    // shows in the app. A provider-supplied `dueWithTime` is routed by the import
    // pipeline through `addAndSchedule` (sets the time + a reminder + Today
    // membership). Only set on initial import: the base poll path drops
    // dueWithTime so a later reschedule in SP is never clobbered.
    const dueWithTime = issue.scheduledAt
      ? new Date(issue.scheduledAt).getTime()
      : undefined;
    return {
      title: issue.title,
      isDone: issue.isDone,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updatedAt).getTime(),
      ...(dueWithTime ? { dueWithTime } : {}),
      // Seed the two-way-sync baseline (last-known remote values) so push-only
      // fields — done and scheduled time — can detect a change. Without it
      // computePushDecisions skips every push as 'no-baseline' and nothing is
      // ever written back. Mirrors the CalDAV provider.
      issueLastSyncedValues: this._syncAdapter.extractSyncValues(
        issue as unknown as Record<string, unknown>,
      ),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: string[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    // Only tasks assigned to me become SP tasks; unclaimed tasks are claimed
    // explicitly via the claim pool, never auto-imported.
    return await firstValueFrom(this._plainspaceApiService.getMyTasks$(cfg));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: PlainspaceCfg,
  ): Observable<IssueData | null> {
    return this._plainspaceApiService.getById$(
      String(id),
      cfg,
    ) as Observable<IssueData | null>;
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: PlainspaceCfg,
  ): Observable<SearchResultItem[]> {
    return this._plainspaceApiService.searchIssues$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as PlainspaceIssue).title;
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as PlainspaceIssue).updatedAt).getTime();
  }
}
