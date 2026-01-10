import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
} from '@angular/material/dialog';
import { IssueLocalState, IssueProviderJira } from '../../../../issue.model';
import { JiraIssueReduced } from '../../jira-issue.model';
import { Observable, of } from 'rxjs';
import { JiraApiService } from '../../jira-api.service';
import { JiraOriginalTransition } from '../../jira-api-responses';
import { SnackService } from '../../../../../../core/snack/snack.service';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { T } from '../../../../../../t.const';
import { Task } from '../../../../../tasks/task.model';
import { IssueService } from '../../../../issue.service';
import { IssueProviderService } from '../../../../issue-provider.service';
import { TaskService } from '../../../../../tasks/task.service';
import { MatIcon } from '@angular/material/icon';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatFormField } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { MatOption } from '@angular/material/core';
import { MatButton } from '@angular/material/button';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'dialog-jira-transition',
  templateUrl: './dialog-jira-transition.component.html',
  styleUrls: ['./dialog-jira-transition.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatIcon,
    CdkScrollable,
    MatDialogContent,
    MatFormField,
    MatSelect,
    FormsModule,
    MatOption,
    MatDialogActions,
    MatButton,
    AsyncPipe,
    TranslatePipe,
  ],
})
export class DialogJiraTransitionComponent {
  private _jiraApiService = inject(JiraApiService);
  private _issueService = inject(IssueService);
  private _issueProviderService = inject(IssueProviderService);
  private _matDialogRef =
    inject<MatDialogRef<DialogJiraTransitionComponent>>(MatDialogRef);
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  data = inject<{
    issue: JiraIssueReduced;
    localState: IssueLocalState;
    task: Task;
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;

  _issueProviderIdOnce$: Observable<string> = this.data.task.issueProviderId
    ? of(this.data.task.issueProviderId)
    : this._taskService.getByIdOnce$(this.data.task.parentId as string).pipe(
        map((parentTask) => {
          if (!parentTask.issueProviderId) {
            throw new Error('No issue provider id found');
          }
          return parentTask.issueProviderId;
        }),
      );

  _jiraCfg$: Observable<IssueProviderJira> = this._issueProviderIdOnce$.pipe(
    switchMap((issueProviderId) =>
      this._issueProviderService.getCfgOnce$(issueProviderId, 'JIRA'),
    ),
  );

  availableTransitions$: Observable<JiraOriginalTransition[]> = this._jiraCfg$.pipe(
    first(),
    switchMap((cfg) =>
      this._jiraApiService.getTransitionsForIssue$(this.data.issue.id, cfg),
    ),
  );

  chosenTransition?: JiraOriginalTransition;

  close(): void {
    this._matDialogRef.close();
  }

  transitionIssue(): void {
    if (this.chosenTransition && this.chosenTransition.id) {
      const trans: JiraOriginalTransition = this.chosenTransition;

      this._jiraCfg$
        .pipe(
          concatMap((jiraCfg) =>
            this._jiraApiService.transitionIssue$(this.data.issue.id, trans.id, jiraCfg),
          ),
          first(),
        )
        .subscribe(() => {
          this._issueService.refreshIssueTask(this.data.task, false, false);
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.JIRA.S.TRANSITION,
            translateParams: { issueKey: this.data.issue.key, name: trans.name },
          });
          this.close();
        });
    }
  }

  trackByIndex(i: number, p: any): number {
    return i;
  }
}
