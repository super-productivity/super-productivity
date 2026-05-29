import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Task } from '../../../../tasks/task.model';
import { JIRA_TYPE } from '../../../issue.const';
import { JiraWorklogService } from '../jira-worklog.service';
import { MsToStringPipe } from '../../../../../ui/duration/ms-to-string.pipe';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../../../t.const';

@Component({
  selector: 'jira-unlogged-summary',
  templateUrl: './jira-unlogged-summary.component.html',
  styleUrls: ['./jira-unlogged-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MsToStringPipe, TranslateModule, MatButton, MatIcon],
})
export class JiraUnloggedSummaryComponent {
  private readonly _jiraWorklogService = inject(JiraWorklogService);
  protected readonly T = T;

  flatTasks = input<Task[]>([]);

  pendingTasks = computed(() =>
    this.flatTasks().filter(
      (t) => t.issueType === JIRA_TYPE && t.timeSpent > (t.issueTimeLogged ?? 0),
    ),
  );

  unloggedMs(task: Task): number {
    return Math.max(0, task.timeSpent - (task.issueTimeLogged ?? 0));
  }

  logWork(task: Task): void {
    this._jiraWorklogService.openWorklogDialogForTask(task);
  }
}
