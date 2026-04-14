import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  selectIsSessionRunning,
  selectProgress,
  selectTimeRemaining,
} from '../../focus-mode/store/focus-mode.selectors';
import { showFocusOverlay } from '../../focus-mode/store/focus-mode.actions';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';

@Component({
  selector: 'focus-mode-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MsToStringPipe],
  template: `
    @if (isRunning()) {
      <div class="session-active">
        <mat-icon>center_focus_strong</mat-icon>
        <div class="time-remaining">{{ timeRemaining() | msToString }}</div>
        <div class="progress-text">{{ progressRounded() }}%</div>
      </div>
    } @else {
      <button
        mat-stroked-button
        (click)="startFocus()"
      >
        <mat-icon>center_focus_strong</mat-icon>
        Start Focus
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--s2);
        height: 100%;
      }

      .session-active {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--s);
      }

      .time-remaining {
        font-size: 1.3em;
        font-weight: 500;
      }

      .progress-text {
        font-size: 0.85em;
        opacity: 0.6;
      }
    `,
  ],
})
export class FocusModeWidgetComponent {
  private _store = inject(Store);

  isRunning = toSignal(this._store.select(selectIsSessionRunning), {
    initialValue: false,
  });
  timeRemaining = toSignal(this._store.select(selectTimeRemaining), {
    initialValue: 0,
  });
  progress = toSignal(this._store.select(selectProgress), {
    initialValue: 0,
  });

  progressRounded = computed(() => Math.round(this.progress()));

  startFocus(): void {
    this._store.dispatch(showFocusOverlay());
  }
}
