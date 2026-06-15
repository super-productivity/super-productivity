import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PlainspaceMember, PlainspaceSharedTask } from '../plainspace-shared-task.model';

interface AssigneeGroup {
  assignee: PlainspaceMember | null;
  label: string;
  initial: string;
  tasks: PlainspaceSharedTask[];
}

/**
 * Read-only list of Plainspace tasks that are assigned to *other* members of a
 * shared project, grouped by assignee.
 *
 * Deliberately a lightweight, standalone component rather than the hot-path
 * `TaskComponent`/`TaskListComponent`: these are foreign tasks that must never
 * be edited, scheduled, time-tracked, drag-reordered, or written into the SP
 * task store / op-log sync. See docs/plainspace-integration-plan.md.
 */
@Component({
  selector: 'plainspace-assigned-to-others',
  templateUrl: './assigned-to-others.component.html',
  styleUrls: ['./assigned-to-others.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatIconButton, MatTooltip, TranslatePipe],
})
export class AssignedToOthersComponent {
  readonly T = T;
  readonly tasks = input<PlainspaceSharedTask[]>([]);

  readonly groups = computed<AssigneeGroup[]>(() => {
    const byAssignee = new Map<string, AssigneeGroup>();

    for (const task of this.tasks()) {
      const key = task.assignee?.id ?? '__unassigned__';
      let group = byAssignee.get(key);
      if (!group) {
        const label = task.assignee?.name ?? '';
        group = {
          assignee: task.assignee,
          label,
          initial: label ? label.charAt(0).toUpperCase() : '?',
          tasks: [],
        };
        byAssignee.set(key, group);
      }
      group.tasks.push(task);
    }

    return [...byAssignee.values()];
  });
}
