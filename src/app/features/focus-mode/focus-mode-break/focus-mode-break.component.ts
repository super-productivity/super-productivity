import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { FocusModeService } from '../focus-mode.service';
import { FocusModeLayoutComponent } from '../focus-mode-layout/focus-mode-layout.component';
import { FocusClockFaceComponent } from '../focus-clock-face/focus-clock-face.component';
import { FocusModeMode, getBreakCycle } from '../focus-mode.model';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { Store } from '@ngrx/store';
import {
  cancelFocusSession,
  completeBreak,
  completeTask,
  pauseFocusSession,
  resetCycles,
  skipBreak,
  unPauseFocusSession,
} from '../store/focus-mode.actions';
import { selectPausedTaskId } from '../store/focus-mode.selectors';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { FocusModeTaskRowComponent } from '../focus-mode-task-row/focus-mode-task-row.component';
import { FocusModeTaskSelectorComponent } from '../focus-mode-task-selector/focus-mode-task-selector.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../../tasks/task.service';

@Component({
  selector: 'focus-mode-break',
  standalone: true,
  imports: [
    FocusModeLayoutComponent,
    MatButtonModule,
    MatIconButton,
    MatTooltip,
    MsToMinuteClockStringPipe,
    MatIcon,
    TranslatePipe,
    FocusModeTaskRowComponent,
    FocusModeTaskSelectorComponent,
    FocusClockFaceComponent,
  ],
  templateUrl: './focus-mode-break.component.html',
  styleUrl: './focus-mode-break.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusModeBreakComponent {
  readonly focusModeService = inject(FocusModeService);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  T: typeof T = T;

  // Get pausedTaskId before break ends (passed in action to avoid race condition)
  private readonly _pausedTaskId = toSignal(this._store.select(selectPausedTaskId));

  // The live tracked task. Set only when tracking continues through the break
  // ("pause tracking during breaks" off); null when tracking is paused for the
  // break, which makes the shared task row fall back to the relax message.
  readonly currentTask = toSignal(this._taskService.currentTask$);

  readonly isTaskSelectorOpen = signal(false);

  readonly remainingTime = computed(() => {
    return this.focusModeService.timeRemaining() || 0;
  });

  readonly progressPercentage = computed(() => {
    return this.focusModeService.progress() || 0;
  });

  readonly isBreakPaused = computed(() => this.focusModeService.isSessionPaused());
  readonly isPomodoro = computed(
    () => this.focusModeService.mode() === FocusModeMode.Pomodoro,
  );

  // currentCycle increments at the end of a focus session, so during the
  // break the store has already moved on. getBreakCycle subtracts 1 (clamped)
  // so the counter shows the cycle the break belongs to — "break of cycle N",
  // matching the user's mental model of "Focus + Break = one cycle".
  readonly displayedCycle = computed(() =>
    getBreakCycle(this.focusModeService.currentCycle() ?? 1),
  );

  // Which break-label translation key to show above the digits. Flowtime breaks
  // aren't Pomodoro short/long, so they read as a neutral "Break".
  readonly breakLabelKey = computed(() => {
    if (this.focusModeService.mode() === FocusModeMode.Flowtime) {
      return T.F.FOCUS_MODE.BREAK_TITLE;
    }
    return this.focusModeService.isBreakLong()
      ? T.F.FOCUS_MODE.LONG_BREAK_TITLE
      : T.F.FOCUS_MODE.SHORT_BREAK_TITLE;
  });

  skipBreak(): void {
    this._store.dispatch(skipBreak({ pausedTaskId: this._pausedTaskId() }));
  }

  completeBreak(): void {
    this._store.dispatch(completeBreak({ pausedTaskId: this._pausedTaskId() }));
  }

  pauseBreak(): void {
    // Bug #5995 Fix: Prefer currentTaskId (actively tracked task) over stored pausedTaskId
    // - If tracking is active during break: use currentTaskId (ensures effect fires)
    // - If tracking was auto-paused: fall back to stored pausedTaskId
    // This matches the banner's approach for consistent behavior
    const currentTaskId = this._taskService.currentTaskId();
    const storePausedTaskId = this._pausedTaskId();
    const pausedTaskId = currentTaskId || storePausedTaskId;

    this._store.dispatch(pauseFocusSession({ pausedTaskId }));
  }

  resumeBreak(): void {
    this._store.dispatch(unPauseFocusSession());
  }

  resetCycles(): void {
    this._store.dispatch(resetCycles());
  }

  exitToPlanning(): void {
    // Cancelling the session clears tracking and hides the overlay (via the
    // cancelFocusSession$ effect), returning the user to wherever they were
    // before focus mode — no forced navigation.
    this._store.dispatch(cancelFocusSession());
  }

  // --- Shared task-row controls (only reachable when tracking continues through
  // the break; otherwise the row shows the relax message and these aren't shown).

  openTaskSelector(): void {
    this.isTaskSelectorOpen.set(true);
  }

  closeTaskSelector(): void {
    this.isTaskSelectorOpen.set(false);
  }

  switchToTask(taskId: string): void {
    this._taskService.setCurrentId(taskId);
  }

  onTaskSelected(taskId: string): void {
    this.switchToTask(taskId);
    this.closeTaskSelector();
  }

  finishCurrentTask(): void {
    this._store.dispatch(completeTask());
    const t = this.currentTask();
    if (t) {
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: { id: t.id, changes: { isDone: true, doneOn: Date.now() } },
        }),
      );
    }
    this.openTaskSelector();
  }

  updateTaskTitle(wasChanged: boolean, newVal: string): void {
    if (!wasChanged) {
      return;
    }
    const t = this.currentTask();
    if (t) {
      this._taskService.update(t.id, { title: newVal });
    }
  }
}
