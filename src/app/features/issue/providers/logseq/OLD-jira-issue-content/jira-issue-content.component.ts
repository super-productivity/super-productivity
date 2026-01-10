import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { TaskWithSubTasks } from '../../../../tasks/task.model';
import {
  JiraComment,
  JiraIssue,
  JiraRelatedIssue,
  JiraSubtask,
} from '../jira-issue.model';
import { expandAnimation } from '../../../../../ui/animations/expand.ani';
import { TaskAttachment } from '../../../../tasks/task-attachment/task-attachment.model';
import { T } from '../../../../../t.const';
import { TaskService } from '../../../../tasks/task.service';
// @ts-ignore
import j2m from 'jira2md';
import {
  combineLatest,
  forkJoin,
  from,
  Observable,
  of,
  ReplaySubject,
  Subject,
} from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { JiraCommonInterfacesService } from '../jira-common-interfaces.service';
import { devError } from '../../../../../util/dev-error';
import { assertTruthy } from '../../../../../util/assert-truthy';
import { MatButton, MatAnchor } from '@angular/material/button';
import { MatChipListbox, MatChipOption } from '@angular/material/chips';
import { MarkdownComponent, MarkdownPipe } from 'ngx-markdown';
import { MatIcon } from '@angular/material/icon';
import { AsyncPipe } from '@angular/common';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { JiraToMarkdownPipe } from '../../../../../ui/pipes/jira-to-markdown.pipe';
import { MsToStringPipe } from '../../../../../ui/duration/ms-to-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { SnackService } from '../../../../../core/snack/snack.service';
import { IssueLog } from '../../../../../core/log';

interface JiraSubtaskWithUrl extends JiraSubtask {
  href: string;
}

@Component({
  selector: 'jira-issue-content',
  templateUrl: './jira-issue-content.component.html',
  styleUrls: ['./jira-issue-content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation],
  imports: [
    MatButton,
    MatChipListbox,
    MatChipOption,
    MarkdownComponent,
    MatAnchor,
    MatIcon,
    AsyncPipe,
    LocaleDatePipe,
    JiraToMarkdownPipe,
    MsToStringPipe,
    TranslatePipe,
    MarkdownPipe,
  ],
})
export class JiraIssueContentComponent {
  private readonly _taskService = inject(TaskService);
  private readonly _snackService = inject(SnackService);
  private readonly _jiraCommonInterfacesService = inject(JiraCommonInterfacesService);

  description?: string;
  attachments?: TaskAttachment[];
  T: typeof T = T;
  issue?: JiraIssue;
  task?: TaskWithSubTasks;
  private _task$: Subject<TaskWithSubTasks> = new ReplaySubject(1);
  private _issue$: Subject<JiraIssue> = new ReplaySubject(1);

  issueUrl$: Observable<string> = this._task$.pipe(
    switchMap((task) =>
      from(
        this._jiraCommonInterfacesService.issueLink(
          assertTruthy(task.issueId),
          assertTruthy(task.issueProviderId),
        ),
      ),
    ),
  );
  jiraSubTasks$: Observable<JiraSubtaskWithUrl[] | undefined> = combineLatest([
    this._task$,
    this._issue$,
  ]).pipe(
    switchMap(([task, issue]) =>
      issue.subtasks?.length
        ? forkJoin(
            ...issue.subtasks.map((ist: JiraSubtask) => {
              return from(
                this._jiraCommonInterfacesService.issueLink(
                  assertTruthy(ist.id),
                  assertTruthy(task.issueProviderId),
                ),
              ).pipe(
                map((issueUrl) => ({
                  ...ist,
                  href: issueUrl,
                })),
              );
            }),
          ).pipe(
            catchError((e) => {
              IssueLog.err(e);
              this._snackService.open({
                type: 'ERROR',
                msg: 'Failed to load subtasks for Jira Issue',
              });
              return of(undefined);
            }),
          )
        : of(undefined),
    ),
  );

  jiraRelatedIssues$: Observable<JiraRelatedIssue[] | undefined> = combineLatest([
    this._task$,
    this._issue$,
  ]).pipe(
    switchMap(([task, issue]) =>
      issue.relatedIssues?.length
        ? forkJoin(
            ...issue.relatedIssues.map((ist: any) => {
              return from(
                this._jiraCommonInterfacesService.issueLink(
                  assertTruthy(ist.key),
                  assertTruthy(task.issueProviderId),
                ),
              ).pipe(
                map((issueUrl) => ({
                  ...ist,
                  href: issueUrl,
                })),
              );
            }),
          )
        : of(undefined),
    ),
  );

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input('issue') set issueIn(i: JiraIssue) {
    this.issue = i;
    this._issue$.next(i);
    try {
      this.description = i && i.description && j2m.to_markdown(i.description);
    } catch (e) {
      IssueLog.log(i);
      devError(e);
      this.description = (i && i.description) || undefined;
    }
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input('task') set taskIn(v: TaskWithSubTasks) {
    this.task = v;
    this._task$.next(v);
  }

  hideUpdates(): void {
    if (!this.task) {
      throw new Error('No task');
    }
    if (!this.issue) {
      throw new Error('No issue');
    }
    this._taskService.markIssueUpdatesAsRead(this.task.id);
  }

  trackByIndex(i: number, p: JiraComment): number {
    return i;
  }

  get sortedComments(): JiraComment[] {
    if (!this.issue?.comments) {
      return [];
    }
    return [...this.issue.comments].sort((a, b) => a.created.localeCompare(b.created));
  }
}
