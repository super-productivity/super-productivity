import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskPriority } from '../task.model';
import { TASK_PRIORITY_ICON, TASK_PRIORITY_LABEL_KEY } from '../task-priority.const';

/**
 * Renders a task's priority as a single coloured icon, the way the overdue
 * schedule icon and the time-conflict "!" already read.
 *
 * Both the task row and the Planner card render this instead of styling a local
 * span: the colour rules then live inside this component's own encapsulation and
 * cannot reach a nested sub-task row.
 */
@Component({
  selector: 'task-priority-indicator',
  template: `<mat-icon
    aria-hidden="false"
    [attr.aria-label]="labelKey() | translate"
    >{{ icon() }}</mat-icon
  >`,
  styleUrl: './task-priority-indicator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatIcon, TranslatePipe],
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    // The colour anchor. It sits on this component's OWN host, inside its own
    // encapsulation, so no descendant selector can reach another task row.
    '[attr.data-priority]': 'priority()',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
})
export class TaskPriorityIndicatorComponent {
  readonly priority = input.required<TaskPriority>();

  readonly icon = computed(() => TASK_PRIORITY_ICON[this.priority()]);
  readonly labelKey = computed(() => TASK_PRIORITY_LABEL_KEY[this.priority()]);
}
