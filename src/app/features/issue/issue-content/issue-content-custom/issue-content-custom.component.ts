import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IssueContentConfig, IssueFieldConfig } from '../issue-content.model';
import { IssueData } from '../../issue.model';
import { OpenProjectAttachmentsComponent } from './open-project-attachments/open-project-attachments.component';
import { JiraLinkComponent } from './jira-link/jira-link.component';
import { TaskCopy } from '../../../tasks/task.model';
import { CaldavTimeComponent } from './caldav-time/caldav-time.component';
import { MatIcon } from '@angular/material/icon';
import { getByPath } from '../get-by-path.util';

@Component({
  selector: 'issue-content-custom',
  templateUrl: './issue-content-custom.component.html',
  styleUrls: ['./issue-content-custom.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    OpenProjectAttachmentsComponent,
    JiraLinkComponent,
    CaldavTimeComponent,
    MatIcon,
  ],
})
export class IssueContentCustomComponent {
  readonly field = input.required<IssueFieldConfig>();
  readonly issue = input.required<IssueData>();
  readonly config = input.required<IssueContentConfig>();
  readonly task = input.required<TaskCopy>();

  getFieldValue(field: IssueFieldConfig, issue: IssueData): any {
    if (typeof field.value === 'function') {
      return field.value(issue);
    }

    return getByPath(issue, field.value);
  }
}
