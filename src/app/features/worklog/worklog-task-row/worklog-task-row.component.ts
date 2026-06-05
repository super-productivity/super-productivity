import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { InlineInputComponent } from '../../../ui/inline-input/inline-input.component';
import { MsToClockStringPipe } from '../../../ui/duration/ms-to-clock-string.pipe';
import { WorklogDataForDay } from '../worklog.model';
import { Task } from '../../tasks/task.model';
import { T } from '../../../t.const';

/**
 * Shared worklog task row used by the History view and the Daily Summary
 * "this week" widget. Uses an attribute selector so the host element IS the
 * `<tr>`, which keeps the surrounding `<table>` markup valid (a `<tr>` may not
 * be wrapped in a component host element).
 */
@Component({
  selector: 'tr[worklogTaskRow]',
  templateUrl: './worklog-task-row.component.html',
  styleUrls: ['./worklog-task-row.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    '[id]': 'rowAnchorId()',
    '[attr.tabindex]': 'rowAnchorId() ? 0 : null',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
  imports: [
    MatIcon,
    MatIconButton,
    TranslatePipe,
    InlineInputComponent,
    MsToClockStringPipe,
  ],
})
export class WorklogTaskRowComponent {
  readonly entry = input.required<WorklogDataForDay>();
  readonly dateStr = input.required<string>();
  // optional project color dot (only shown for the combined "Today" list)
  readonly projectColor = input<{ title: string; color: string } | null>(null);
  // whether to render the trailing actions column (and thus a restore button)
  readonly hasActionsColumn = input<boolean>(false);
  readonly canRestore = input<boolean>(false);
  readonly showRepeatIcon = input<boolean>(true);
  // when set, renders the `t-<taskId>` scroll anchor used by deep-links
  readonly rowAnchorId = input<string | null>(null);

  readonly taskClick = output<Task>();
  readonly restore = output<Task>();
  readonly timeChange = output<number | string>();

  T: typeof T = T;
}
