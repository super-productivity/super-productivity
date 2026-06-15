import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton, MatFabButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskTitleComponent } from '../../../ui/task-title/task-title.component';
import { FocusModeTaskTrackingComponent } from '../focus-mode-task-tracking/focus-mode-task-tracking.component';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { Task } from '../../tasks/task.model';
import { T } from '../../../t.const';

/**
 * Shared task module for the timer screens (focus session + break). One of three
 * states:
 *  - `task` set → the task row: switch · editable title · read-only time · finish.
 *  - no task + `showRelaxMessage` → the break's "take a moment to relax" note.
 *  - no task + no relax message → the "select a task" CTA (the focus session's
 *    pre-task state).
 *
 * Purely presentational — it emits intent (switch / finish / select / title
 * edited); each consumer wires those to the action that fits its context. The
 * muted controls follow the host's `--revealed-opacity` hover-reveal where one
 * exists (focus session) and stay visible where it doesn't (break).
 */
@Component({
  selector: 'focus-mode-task-row',
  standalone: true,
  imports: [
    TaskTitleComponent,
    FocusModeTaskTrackingComponent,
    MatIcon,
    MatIconButton,
    MatFabButton,
    MatTooltip,
    TranslatePipe,
  ],
  template: `
    @if (task(); as t) {
      @if (parentTitle()) {
        <div class="parent-title">
          <div class="title">{{ parentTitle() }}</div>
        </div>
      }
      <div class="task-title-row">
        <button
          mat-icon-button
          class="task-side-btn task-side-btn--switch"
          (click)="$event.stopPropagation(); switchTask.emit()"
          [matTooltip]="T.F.FOCUS_MODE.SWITCH_TASK | translate"
        >
          <mat-icon>swap_horiz</mat-icon>
        </button>

        <task-title
          @fade
          (valueEdited)="
            titleEdited.emit({ wasChanged: $event.wasChanged, newVal: $event.newVal })
          "
          [value]="t.title"
          class="task-title"
        ></task-title>

        <div class="task-end-controls">
          <focus-mode-task-tracking [task]="t"></focus-mode-task-tracking>

          <button
            mat-icon-button
            class="task-side-btn"
            [matTooltip]="T.F.FOCUS_MODE.FINISH_TASK_AND_SELECT_NEXT | translate"
            (click)="finishTask.emit()"
          >
            <mat-icon>done</mat-icon>
          </button>
        </div>
      </div>
    } @else if (showRelaxMessage()) {
      <p class="task-title break-message">
        {{ T.F.FOCUS_MODE.BREAK_RELAX_MSG | translate }}
      </p>
    } @else {
      <button
        mat-fab
        extended
        color="primary"
        class="select-task-cta task-title-placeholder"
        (click)="$event.stopPropagation(); selectTask.emit()"
      >
        <mat-icon>add_task</mat-icon>
        {{ T.F.FOCUS_MODE.SELECT_TASK_TO_FOCUS | translate }}
      </button>
    }
  `,
  styleUrl: './focus-mode-task-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation],
})
export class FocusModeTaskRowComponent {
  protected readonly T = T;

  readonly task = input<Task | null>(null);
  readonly parentTitle = input<string | null>(null);
  // When there is no task: true → the break's relax message, false → the
  // "select a task" CTA (focus session).
  readonly showRelaxMessage = input<boolean>(false);

  readonly switchTask = output<void>();
  readonly finishTask = output<void>();
  readonly selectTask = output<void>();
  readonly titleEdited = output<{ wasChanged: boolean; newVal: string }>();
}
