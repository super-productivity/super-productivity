import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { first } from 'rxjs/operators';
import { GITLAB_TYPE } from '../../issue.const';
import { IssueProviderService } from '../../issue-provider.service';
import { TaskCopy } from '../../../tasks/task.model';
import { BeforeFinishDayService } from '../../../before-finish-day/before-finish-day.service';
import { Store } from '@ngrx/store';
import { selectAllTasksInActiveProjects } from '../../../tasks/store/task.selectors';

@Injectable()
export class GitlabIssueEffects {
  private readonly _matDialog = inject(MatDialog);
  private readonly _beforeFinishDayService = inject(BeforeFinishDayService);
  private readonly _store = inject(Store);
  private readonly _issueProviderService = inject(IssueProviderService);

  constructor() {
    this._beforeFinishDayService.addAction(async (dayStr) => {
      // The summary includes worked-on tasks from every context, including tasks
      // that the user has configured not to auto-add to Today. `dayStr`, not
      // today: the daily summary can finish a past day, and the worklog must
      // report the hours booked on THAT day.
      const tasks = await this._store
        .select(selectAllTasksInActiveProjects)
        .pipe(first())
        .toPromise();
      const gitlabTasks = tasks.filter(
        (t) => t.issueType === GITLAB_TYPE && (t.timeSpentOnDay?.[dayStr] ?? 0) > 0,
      );
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
                    day: dayStr,
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
