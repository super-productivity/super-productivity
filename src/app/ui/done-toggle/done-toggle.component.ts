import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'done-toggle',
  templateUrl: './done-toggle.component.html',
  styleUrl: './done-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    '(click)': 'toggled.emit(); $event.stopPropagation()',
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
  readonly toggled = output<void>();
}
