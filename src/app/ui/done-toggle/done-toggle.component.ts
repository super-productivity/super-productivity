import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { isMultiSelectModifierEvent } from '../../util/is-multi-select-modifier-event';

@Component({
  selector: 'done-toggle',
  templateUrl: './done-toggle.component.html',
  styleUrl: './done-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    '(click)': 'onClick($event)',
    '(keydown.enter)': 'toggled.emit(); $event.stopPropagation()',
    '(keydown.space)':
      'toggled.emit(); $event.stopPropagation(); $event.preventDefault()',
    role: 'checkbox',
    '[attr.aria-checked]': 'isDone()',
    tabindex: '0',
    '[class.is-done]': '(showDoneAnimation() || isDone()) && !showUndoneAnimation()',
    '[class.is-current]': 'isCurrent()',
    '[class.is-scale-up]': 'showDoneAnimation() || showUndoneAnimation()',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
})
export class DoneToggleComponent {
  readonly isDone = input.required<boolean>();
  readonly isCurrent = input<boolean>(false);
  readonly showDoneAnimation = input<boolean>(false);
  readonly showUndoneAnimation = input<boolean>(false);
  /**
   * Opt in where the surrounding row supports multi-select (the task list).
   * Off by default: the Planner renders this same toggle and has no
   * multi-select, so a modifier click there must still mark the task done —
   * bailing unconditionally swallowed the toggle and let the click bubble to
   * the planner row, which opened the detail panel instead.
   */
  readonly isMultiSelectAware = input<boolean>(false);
  readonly toggled = output<void>();

  onClick(ev: MouseEvent): void {
    // A modifier click selects the task row instead of toggling done; let it
    // bubble to the row.
    if (this.isMultiSelectAware() && isMultiSelectModifierEvent(ev)) {
      return;
    }
    this.toggled.emit();
    ev.stopPropagation();
  }
}
