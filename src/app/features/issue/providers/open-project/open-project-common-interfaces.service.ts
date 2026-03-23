import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { first, map } from 'rxjs/operators';
import { Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { OpenProjectApiService } from './open-project-api.service';
import { OpenProjectCfg } from './open-project.model';
import {
  OpenProjectWorkPackage,
  OpenProjectWorkPackageReduced,
} from './open-project-issue.model';
import { isOpenProjectEnabled } from './is-open-project-enabled.util';
import { OPEN_PROJECT_POLL_INTERVAL } from './open-project.const';
import { parseOpenProjectDuration } from './open-project-view-components/parse-open-project-duration.util';
import {
  formatOpenProjectWorkPackageSubject,
  formatOpenProjectWorkPackageSubjectForSnack,
} from './format-open-project-work-package-subject.util';
import { IssueLog } from '../../../../core/log';

@Injectable({
  providedIn: 'root',
})
export class OpenProjectCommonInterfacesService extends BaseIssueProviderService<OpenProjectCfg> {
  private readonly _openProjectApiService = inject(OpenProjectApiService);

  readonly providerKey = 'OPEN_PROJECT' as const;
  readonly pollInterval: number = OPEN_PROJECT_POLL_INTERVAL;

  isEnabled(cfg: OpenProjectCfg): boolean {
    return isOpenProjectEnabled(cfg);
  }

  testConnection(cfg: OpenProjectCfg): Promise<boolean> {
    return firstValueFrom(
      this._openProjectApiService.searchIssueForRepo$('', cfg).pipe(
        map((res) => Array.isArray(res)),
        first(),
      ),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: number, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => `${cfg.host}/projects/${cfg.projectId}/work_packages/${issueId}`),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(
    issue: OpenProjectWorkPackageReduced,
  ): Partial<Task> & { title: string } {
    const parsedEstimate: number = parseOpenProjectDuration(
      issue.estimatedTime as string | number | null,
    );

    return {
      title: formatOpenProjectWorkPackageSubject(issue),
      issuePoints: issue.storyPoints || undefined,
      issueWasUpdated: false,
      // OpenProject returns startDate as YYYY-MM-DD string, use directly
      // to avoid timezone conversion issues
      dueDay: issue.startDate || undefined,
      issueLastUpdated: new Date(issue.updatedAt).getTime(),
      ...(parsedEstimate > 0 ? { timeEstimate: parsedEstimate } : {}),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<OpenProjectWorkPackageReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const workPackages = await firstValueFrom(
      this._openProjectApiService.getLast100WorkPackagesForCurrentOpenProjectProject$(
        cfg,
      ),
    );
    IssueLog.log(workPackages);
    return workPackages;
  }

  protected _apiGetById$(
    id: string | number,
    cfg: OpenProjectCfg,
  ): Observable<IssueData | null> {
    return this._openProjectApiService.getById$(+id, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: OpenProjectCfg,
  ): Observable<SearchResultItem[]> {
    return this._openProjectApiService.searchIssueForRepo$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return formatOpenProjectWorkPackageSubjectForSnack(issue as OpenProjectWorkPackage);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as OpenProjectWorkPackage).updatedAt).getTime();
  }
}
