import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { first } from 'rxjs/operators';
import { GITLAB_TYPE } from '../../issue.const';
import { IssueProviderService } from '../../issue-provider.service';
import { TaskCopy } from '../../../tasks/task.model';
import { BeforeFinishDayService } from '../../../before-finish-day/before-finish-day.service';
import { WorkContextService } from '../../../work-context/work-context.service';

@Injectable()
export class GitlabIssueEffects {
  private readonly _matDialog = inject(MatDialog);
  private readonly _beforeFinishDayService = inject(BeforeFinishDayService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _issueProviderService = inject(IssueProviderService);

  constructor() {
    this._beforeFinishDayService.addAction(async () => {
      const tasksForCurrentList =
        await this._workContextService.allTasksForCurrentContext$
          .pipe(first())
          .toPromise();
      const gitlabTasks = tasksForCurrentList.filter((t) => t.issueType === GITLAB_TYPE);
      if (gitlabTasks.length > 0) {
        // sort gitlab tasks by issueProviderId
        const gitlabTasksByIssueProviderId: { [key: string]: TaskCopy[] } =
          gitlabTasks.reduce(
            (acc, task) => {
              if (typeof task.issueProviderId === 'string') {
                acc[task.issueProviderId] = acc[task.issueProviderId] || [];
                acc[task.issueProviderId].push(task);
              }
              return acc;
            },
            {} as { [key: string]: TaskCopy[] },
          );
        await Promise.all(
          Object.keys(gitlabTasksByIssueProviderId).map(async (issueProviderId) => {
            const tasksForIssueProvider = gitlabTasksByIssueProviderId[issueProviderId];
            const gitlabCfgForProvider = await this._issueProviderService
              .getCfgOnce$(issueProviderId, 'GITLAB')
              .pipe(first())
              .toPromise();
            if (
              gitlabCfgForProvider &&
              gitlabCfgForProvider.isEnabled &&
              gitlabCfgForProvider.isEnableTimeTracking
            ) {
              const { DialogGitlabSubmitWorklogForDayComponent } =
                await import('./dialog-gitlab-submit-worklog-for-day/dialog-gitlab-submit-worklog-for-day.component');
              await this._matDialog
                .open(DialogGitlabSubmitWorklogForDayComponent, {
                  restoreFocus: true,
                  disableClose: true,
                  closeOnNavigation: false,
                  data: {
                    gitlabCfg: gitlabCfgForProvider,
                    issueProviderId,
                    tasksForIssueProvider,
                  },
                })
                .afterClosed()
                .toPromise();
            }
          }),
        );
      }

      return 'SUCCESS';
    });
  }
}
