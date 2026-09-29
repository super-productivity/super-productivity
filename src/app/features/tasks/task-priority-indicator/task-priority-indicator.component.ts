import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskPriority } from '../task.model';
import {
  DEFAULT_TASK_PRIORITY_ICON_PRESET,
  TASK_PRIORITY_CHEVRON_ICON,
  TASK_PRIORITY_DOTS,
  TASK_PRIORITY_LABEL_KEY,
} from '../task-priority.const';
import { GlobalConfigService } from '../../config/global-config.service';

/**
 * Renders a task's priority as a single coloured glyph in the user's chosen
 * preset (chevrons, numbers or dots), the way the overdue schedule icon and the
 * time-conflict "!" already read.
 *
 * Both the task row and the Planner card render this instead of styling a local
 * span: the colour rules then live inside this component's own encapsulation and
 * cannot reach a nested sub-task row. Menus reuse it as their item icon with
 * `isDecorative`, since the item's own text already names the level.
 */
@Component({
  selector: 'task-priority-indicator',
  template: `@if (labelKey()) {
    <span
      class="glyph"
      [attr.role]="isDecorative() ? null : 'img'"
      [attr.aria-label]="isDecorative() ? null : (labelKey() | translate)"
      [attr.aria-hidden]="isDecorative() ? 'true' : null"
    >
      @switch (preset()) {
        @case ('numbers') {
          <span class="number">{{ priority() }}</span>
        }
        @case ('dots') {
          @for (dot of dots(); track dot) {
            <span class="dot"></span>
          }
        }
        @default {
          <mat-icon>{{ icon() }}</mat-icon>
        }
      }
    </span>
  }`,
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
  private readonly _globalConfigService = inject(GlobalConfigService);

  readonly priority = input.required<TaskPriority>();
  readonly isDecorative = input(false);

  readonly preset = computed(
    () =>
      this._globalConfigService.cfg()?.tasks?.priorityIconPreset ??
      DEFAULT_TASK_PRIORITY_ICON_PRESET,
  );

  // A value outside 1–3 (e.g. a string written by an old test build) has no
  // label, so the template renders nothing for it instead of throwing.
  readonly icon = computed(() => TASK_PRIORITY_CHEVRON_ICON[this.priority()] ?? '');
  readonly dots = computed(() => TASK_PRIORITY_DOTS[this.priority()] ?? []);
  readonly labelKey = computed(() => TASK_PRIORITY_LABEL_KEY[this.priority()] ?? '');
}
