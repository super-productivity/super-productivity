import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { Store } from '@ngrx/store';
import { WorkContextService } from '../../work-context/work-context.service';
import { setCurrentTask } from '../../tasks/store/task.actions';
import { TaskService } from '../../tasks/task.service';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';

@Component({
  selector: 'task-list-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatIconButton, MsToStringPipe],
  template: `
    @if (undoneTasks().length === 0) {
      <div class="empty">
        <mat-icon>task_alt</mat-icon>
        <span>All done for today!</span>
      </div>
    } @else {
      <div class="task-list">
        @for (task of undoneTasks(); track task.id) {
          <div
            class="task-row"
            [class.is-current]="task.id === currentTaskId()"
          >
            <button
              mat-icon-button
              class="play-btn"
              (click)="startTask(task.id)"
            >
              <mat-icon>{{
                task.id === currentTaskId() ? 'pause' : 'play_arrow'
              }}</mat-icon>
            </button>
            <span class="task-title">{{ task.title }}</span>
            @if (task.timeEstimate > 0) {
              <span class="task-estimate">{{ task.timeEstimate | msToString }}</span>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--s-half) 0;
        height: 100%;
        overflow: auto;
      }

      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--s2);
        height: 100%;
        opacity: 0.5;
        padding: var(--s2);
      }

      .task-list {
        display: flex;
        flex-direction: column;
      }

      .task-row {
        display: flex;
        align-items: center;
        padding: var(--s-quarter) var(--s);
        gap: var(--s-half);
        border-bottom: 1px solid var(--divider-color);
        min-height: 40px;
      }

      .task-row:last-child {
        border-bottom: none;
      }

      .task-row.is-current {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      }

      .play-btn {
        flex-shrink: 0;
        width: 32px;
        height: 32px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .task-title {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 0.9em;
      }

      .task-estimate {
        opacity: 0.5;
        font-size: 0.8em;
        flex-shrink: 0;
      }
    `,
  ],
})
export class TaskListWidgetComponent {
  private _store = inject(Store);
  private _workContextService = inject(WorkContextService);
  private _taskService = inject(TaskService);

  currentTaskId = this._taskService.currentTaskId;

  private _allUndone = toSignal(this._workContextService.undoneTasks$, {
    initialValue: [],
  });

  undoneTasks = computed(() => this._allUndone().slice(0, 15));

  startTask(taskId: string): void {
    const isCurrent = this.currentTaskId() === taskId;
    this._store.dispatch(setCurrentTask({ id: isCurrent ? null : taskId }));
  }
}
