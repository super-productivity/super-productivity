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
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
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
        <div class="menu-section-label">Status</div>
        @for (opt of filterOptions; track opt.value) {
          <button
            mat-menu-item
            (click)="setFilter(opt.value)"
          >
            <mat-icon>{{
              cfg.filter === opt.value ? 'radio_button_checked' : 'radio_button_unchecked'
            }}</mat-icon>
            <span>{{ opt.label }}</span>
          </button>
        }
        <div class="menu-section-label">Project</div>
        <button
          mat-menu-item
          (click)="setProject(null)"
        >
          <mat-icon>{{
            !cfg.projectId ? 'radio_button_checked' : 'radio_button_unchecked'
          }}</mat-icon>
          <span>Current context</span>
        </button>
        @for (project of projects(); track project.id) {
          <button
            mat-menu-item
            (click)="setProject(project.id)"
          >
            <mat-icon>{{
              cfg.projectId === project.id
                ? 'radio_button_checked'
                : 'radio_button_unchecked'
            }}</mat-icon>
            <span>{{ project.title }}</span>
          </button>
        }
        <div class="menu-section-label">Tag</div>
        <button
          mat-menu-item
          (click)="setTag(null)"
        >
          <mat-icon>{{
            !cfg.tagId ? 'radio_button_checked' : 'radio_button_unchecked'
          }}</mat-icon>
          <span>Any</span>
        </button>
        @for (tag of tags(); track tag.id) {
          <button
            mat-menu-item
            (click)="setTag(tag.id)"
          >
            <mat-icon>{{
              cfg.tagId === tag.id ? 'radio_button_checked' : 'radio_button_unchecked'
            }}</mat-icon>
            <span>{{ tag.title }}</span>
          </button>
        }
      </mat-menu>
      <span class="filter-label">{{ filterSummary() }}</span>
    </div>
    @if (filteredTasks().length === 0) {
      <div class="empty">
        <mat-icon>task_alt</mat-icon>
        <span>{{ emptyMessage }}</span>
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
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);

  @Input() set config(val: TaskListWidgetConfig | undefined) {
    this.cfg = val ?? DEFAULT_TASK_LIST_CONFIG;
  }

  @Output() configChange = new EventEmitter<TaskListWidgetConfig>();

  cfg: TaskListWidgetConfig = DEFAULT_TASK_LIST_CONFIG;

  currentTaskId = this._taskService.currentTaskId;
  projects = this._projectService.listSortedForUI;
  tags = this._tagService.tagsNoMyDayAndNoList;

  filterOptions: { value: TaskListFilter; label: string }[] = [
    { value: 'undone', label: 'Undone' },
    { value: 'done', label: 'Done' },
    { value: 'all', label: 'All' },
  ];

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
    if (this.cfg.projectId) {
      tasks = tasks.filter((t) => t.projectId === this.cfg.projectId);
    }
    if (this.cfg.tagId) {
      tasks = tasks.filter((t) => t.tagIds?.includes(this.cfg.tagId!));
    }
    return tasks.slice(0, this.cfg.maxTasks);
  });

  filterSummary = computed(() => {
    const parts: string[] = [];
    const filterLabel =
      this.filterOptions.find((o) => o.value === this.cfg.filter)?.label ?? 'Undone';
    parts.push(filterLabel);
    if (this.cfg.projectId) {
      const p = this.projects().find((pr) => pr.id === this.cfg.projectId);
      if (p) {
        parts.push(p.title);
      }
    }
    if (this.cfg.tagId) {
      const t = this.tags().find((tg) => tg.id === this.cfg.tagId);
      if (t) {
        parts.push('#' + t.title);
      }
    }
    return parts.join(' · ');
  });

  get emptyMessage(): string {
    return this.cfg.filter === 'done' ? 'No completed tasks' : 'All done!';
  }

  setFilter(filter: TaskListFilter): void {
    this.cfg = { ...this.cfg, filter };
    this.configChange.emit(this.cfg);
  }

  setProject(projectId: string | null): void {
    this.cfg = { ...this.cfg, projectId };
    this.configChange.emit(this.cfg);
  }

  setTag(tagId: string | null): void {
    this.cfg = { ...this.cfg, tagId };
    this.configChange.emit(this.cfg);
  }

  startTask(taskId: string): void {
    const isCurrent = this.currentTaskId() === taskId;
    this._store.dispatch(setCurrentTask({ id: isCurrent ? null : taskId }));
  }
}
