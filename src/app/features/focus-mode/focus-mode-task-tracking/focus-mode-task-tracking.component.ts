import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { Task } from '../../tasks/task.model';
import { T } from '../../../t.const';

/**
 * Inline tracking control for the focused task, mirroring the task-list row's
 * `time-wrapper` (vertical spent / estimate stack) plus a play/pause that
 * reveals on hover. Sits in the timer screens' task row (right before the
 * finish button on the focus session; next to the title on the break).
 *
 * Purely presentational. `showToggle` lets a consumer render the time read-only
 * (the break does this — task tracking there is coupled to the break timer, so
 * a toggle would also pause/skip the break). When the toggle is shown, the
 * parent wires `(toggleTracking)` to the action that fits its context.
 *
 * The play/pause button reads `--revealed-opacity` so it follows the focus
 * session's hover-reveal like the switch/finish buttons; the fallback `1` keeps
 * it visible where no hover-reveal mechanism exists.
 */
@Component({
  selector: 'focus-mode-task-tracking',
  standalone: true,
  imports: [MatIcon, MatIconButton, MatTooltip, TranslatePipe, MsToStringPipe],
  template: `
    @if (hasTime()) {
      <div class="time-wrapper">
        <div class="time">
          @if (task().timeSpent) {
            <span
              class="time-val"
              [innerHTML]="task().timeSpent | msToString"
            ></span>
            <span class="separator">/</span>
          }
          <span
            class="time-val"
            [innerHTML]="task().timeEstimate | msToString"
          ></span>
        </div>
      </div>
    }

    @if (showToggle()) {
      <button
        mat-icon-button
        class="play-pause-btn"
        [matTooltip]="
          (isTracking() ? T.F.FOCUS_MODE.PAUSE_TRACKING : T.F.FOCUS_MODE.RESUME_TRACKING)
            | translate
        "
        (click)="toggleTracking.emit()"
      >
        <mat-icon>{{ isTracking() ? 'pause' : 'play_arrow' }}</mat-icon>
      </button>
    }
  `,
  styleUrl: './focus-mode-task-tracking.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusModeTaskTrackingComponent {
  protected readonly T = T;

  readonly task = input.required<Task>();
  readonly isTracking = input<boolean>(false);
  readonly showToggle = input<boolean>(true);

  readonly toggleTracking = output<void>();

  protected readonly hasTime = computed(
    () => !!this.task().timeSpent || !!this.task().timeEstimate,
  );
}
