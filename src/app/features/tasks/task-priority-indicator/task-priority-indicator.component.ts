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
  TASK_PRIORITY_ICONS,
  TASK_PRIORITY_LABEL_KEY,
} from '../task-priority.const';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskPriorityIconPreset } from '../../config/global-config.model';

/**
 * A task's priority as one coloured icon in the user's chosen preset, like the
 * overdue schedule icon and the time-conflict "!".
 *
 * The colour rules live in this component's own encapsulation, so they cannot
 * reach a nested sub-task row. Menus put `aria-hidden="true"` on it, since the
 * item's own text already names the level. The icon is drawn via `fontIcon`
 * (no text node), so a host's `textContent` — e.g. mat-option's announced
 * `viewValue` — never includes the icon name.
 */
@Component({
  selector: 'task-priority-indicator',
  template: `@if (icon(); as icon) {
    <mat-icon
      class="icon"
      role="img"
      aria-hidden="false"
      [attr.aria-label]="labelKey() | translate"
      [fontIcon]="icon"
    ></mat-icon>
  }`,
  styleUrl: './task-priority-indicator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatIcon, TranslatePipe],
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    // The colour anchor, on this component's own host.
    '[attr.data-priority]': 'priority()',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
})
export class TaskPriorityIndicatorComponent {
  private readonly _globalConfigService = inject(GlobalConfigService);

  readonly priority = input.required<TaskPriority>();
  /** Overrides the configured preset, e.g. to preview each preset in settings. */
  readonly iconPreset = input<TaskPriorityIconPreset>();

  // The synced preset is an opaque string; unknown values fall back to the default.
  private readonly _icons = computed(
    () =>
      TASK_PRIORITY_ICONS[
        (this.iconPreset() ??
          this._globalConfigService.cfg()?.tasks
            ?.priorityIconPreset) as TaskPriorityIconPreset
      ] ?? TASK_PRIORITY_ICONS[DEFAULT_TASK_PRIORITY_ICON_PRESET],
  );
  // Empty for a value outside 1–3 (e.g. a stale test-build string): renders nothing.
  readonly icon = computed(() => this._icons()[this.priority()]);
  readonly labelKey = computed(() => TASK_PRIORITY_LABEL_KEY[this.priority()]);
}
