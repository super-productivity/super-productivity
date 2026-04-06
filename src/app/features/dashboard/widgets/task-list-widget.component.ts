import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  Input,
  Output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Store } from '@ngrx/store';
import { WorkContextService } from '../../work-context/work-context.service';
import { setCurrentTask } from '../../tasks/store/task.actions';
import { TaskService } from '../../tasks/task.service';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { TaskListFilter, TaskListWidgetConfig } from '../dashboard.model';
import { DEFAULT_TASK_LIST_CONFIG } from '../dashboard.const';

@Component({
  selector: 'task-list-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatIconButton, MatMenuModule, MsToStringPipe],
  template: `
    <div class="widget-toolbar">
      <button
        mat-icon-button
        [matMenuTriggerFor]="filterMenu"
        class="filter-btn"
      >
        <mat-icon>filter_list</mat-icon>
      </button>
      <mat-menu #filterMenu="matMenu">
        <button
          mat-menu-item
          (click)="setFilter('undone')"
        >
          <mat-icon>{{
            cfg.filter === 'undone' ? 'radio_button_checked' : 'radio_button_unchecked'
          }}</mat-icon>
          <span>Undone</span>
        </button>
        <button
          mat-menu-item
          (click)="setFilter('done')"
        >
          <mat-icon>{{
            cfg.filter === 'done' ? 'radio_button_checked' : 'radio_button_unchecked'
          }}</mat-icon>
          <span>Done</span>
        </button>
        <button
          mat-menu-item
          (click)="setFilter('all')"
        >
          <mat-icon>{{
            cfg.filter === 'all' ? 'radio_button_checked' : 'radio_button_unchecked'
          }}</mat-icon>
          <span>All</span>
        </button>
      </mat-menu>
      <span class="filter-label">{{ filterLabel }}</span>
    </div>
    @if (filteredTasks().length === 0) {
      <div class="empty">
        <mat-icon>task_alt</mat-icon>
        <span>{{
          cfg.filter === 'done' ? 'No completed tasks' : 'All done for today!'
        }}</span>
      </div>
    } @else {
      <div class="task-list">
        @for (task of filteredTasks(); track task.id) {
          <div
            class="task-row"
            [class.is-current]="task.id === currentTaskId()"
            [class.is-done]="task.isDone"
          >
            <button
              mat-icon-button
              class="play-btn"
              (click)="startTask(task.id)"
            >
              <mat-icon>{{
                task.isDone
                  ? 'check_circle'
                  : task.id === currentTaskId()
                    ? 'pause'
                    : 'play_arrow'
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
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .widget-toolbar {
        display: flex;
        align-items: center;
        padding: 0 var(--s);
        gap: var(--s-half);
      }

      .filter-btn {
        width: 32px;
        height: 32px;
        opacity: 0.5;
      }

      .filter-label {
        font-size: 0.8em;
        opacity: 0.5;
      }

      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--s2);
        flex: 1;
        opacity: 0.5;
        padding: var(--s2);
      }

      .task-list {
        display: flex;
        flex-direction: column;
        overflow: auto;
        flex: 1;
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

      .task-row.is-done {
        opacity: 0.5;
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

      .is-done .task-title {
        text-decoration: line-through;
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

  @Input() set config(val: TaskListWidgetConfig | undefined) {
    this.cfg = val ?? DEFAULT_TASK_LIST_CONFIG;
  }

  @Output() configChange = new EventEmitter<TaskListWidgetConfig>();

  cfg: TaskListWidgetConfig = DEFAULT_TASK_LIST_CONFIG;

  currentTaskId = this._taskService.currentTaskId;

  private _undone = toSignal(this._workContextService.undoneTasks$, {
    initialValue: [],
  });

  private _done = toSignal(this._workContextService.doneTasks$, {
    initialValue: [],
  });

  filteredTasks = computed(() => {
    let tasks;
    switch (this.cfg.filter) {
      case 'done':
        tasks = this._done();
        break;
      case 'all':
        tasks = [...this._undone(), ...this._done()];
        break;
      default:
        tasks = this._undone();
    }
    return tasks.slice(0, this.cfg.maxTasks);
  });

  get filterLabel(): string {
    switch (this.cfg.filter) {
      case 'done':
        return 'Done';
      case 'all':
        return 'All';
      default:
        return 'Undone';
    }
  }

  setFilter(filter: TaskListFilter): void {
    this.cfg = { ...this.cfg, filter };
    this.configChange.emit(this.cfg);
  }

  startTask(taskId: string): void {
    const isCurrent = this.currentTaskId() === taskId;
    this._store.dispatch(setCurrentTask({ id: isCurrent ? null : taskId }));
  }
}
