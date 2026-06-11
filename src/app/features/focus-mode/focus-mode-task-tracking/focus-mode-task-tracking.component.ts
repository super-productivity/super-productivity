import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { Task } from '../../tasks/task.model';

/**
 * Read-only time stack for the focused task, mirroring the task-list row's
 * `time-wrapper` (vertical spent / estimate stack). Sits in the timer screens'
 * task row next to the title. Tracking start/stop lives on the global header
 * play button, not in the timer views.
 */
@Component({
  selector: 'focus-mode-task-tracking',
  standalone: true,
  imports: [MsToStringPipe],
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
  `,
  styleUrl: './focus-mode-task-tracking.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusModeTaskTrackingComponent {
  readonly task = input.required<Task>();

  protected readonly hasTime = computed(
    () => !!this.task().timeSpent || !!this.task().timeEstimate,
  );
}
