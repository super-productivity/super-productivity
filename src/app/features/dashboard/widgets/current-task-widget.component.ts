import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import {
  setCurrentTask,
  toggleStart,
  updateTaskUi,
} from '../../tasks/store/task.actions';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';

@Component({
  selector: 'current-task-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatIconButton, MsToStringPipe],
  template: `
    @if (currentTask(); as task) {
      <div class="task-info">
        <div class="task-title">{{ task.title }}</div>
        <div class="task-time">{{ task.timeSpent | msToString }}</div>
      </div>
      <div class="task-actions">
        <button
          mat-icon-button
          (click)="toggleStart()"
        >
          <mat-icon>pause</mat-icon>
        </button>
        <button
          mat-icon-button
          (click)="markDone()"
        >
          <mat-icon>done</mat-icon>
        </button>
      </div>
    } @else {
      <div class="no-task">
        <mat-icon>play_circle</mat-icon>
        <span>No active task</span>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--s2);
        height: 100%;
      }

      .task-info {
        flex: 1;
        min-width: 0;
      }

      .task-title {
        font-size: 1.1em;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .task-time {
        font-size: 1.4em;
        font-weight: 300;
        opacity: 0.8;
        margin-top: var(--s);
      }

      .task-actions {
        display: flex;
        gap: var(--s);
      }

      .no-task {
        display: flex;
        align-items: center;
        gap: var(--s2);
        opacity: 0.5;
        width: 100%;
        justify-content: center;
      }

      .no-task mat-icon {
        font-size: 2em;
        width: 2em;
        height: 2em;
      }
    `,
  ],
})
export class CurrentTaskWidgetComponent {
  private _store = inject(Store);
  currentTask = toSignal(this._store.select(selectCurrentTask));

  toggleStart(): void {
    this._store.dispatch(toggleStart());
  }

  markDone(): void {
    const task = this.currentTask();
    if (task) {
      this._store.dispatch(
        updateTaskUi({ task: { id: task.id, changes: { isDone: true } } }),
      );
      this._store.dispatch(setCurrentTask({ id: null }));
    }
  }
}
