import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectTasksWorkedOnOrDoneFlat } from '../../tasks/store/task.selectors';
import { getTodayStr } from '../../tasks/util/get-today-str';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'recent-activity-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, DatePipe],
  template: `
    @if (recentDone().length === 0) {
      <div class="empty">
        <mat-icon>history</mat-icon>
        <span>No completed tasks today</span>
      </div>
    } @else {
      <div class="activity-list">
        @for (task of recentDone(); track task.id) {
          <div class="activity-item">
            <mat-icon>check_circle</mat-icon>
            <span class="task-title">{{ task.title }}</span>
            @if (task.doneOn) {
              <span class="time">{{ task.doneOn | date: 'shortTime' }}</span>
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
        padding: var(--s2);
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
      }

      .activity-list {
        display: flex;
        flex-direction: column;
        gap: var(--s1);
      }

      .activity-item {
        display: flex;
        align-items: center;
        gap: var(--s1);
        padding: var(--s1) 0;
        border-bottom: 1px solid var(--contrast-50);
      }

      .activity-item:last-child {
        border-bottom: none;
      }

      .activity-item mat-icon {
        color: var(--color-primary);
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }

      .task-title {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .time {
        opacity: 0.6;
        font-size: 0.85em;
        flex-shrink: 0;
      }
    `,
  ],
})
export class RecentActivityWidgetComponent {
  private _store = inject(Store);
  private _todayStr = getTodayStr();

  private _todayTasks = toSignal(
    this._store.select(selectTasksWorkedOnOrDoneFlat, { day: this._todayStr }),
    { initialValue: [] as any[] },
  );

  recentDone = computed(() =>
    (this._todayTasks() || [])
      .filter((t) => t.isDone && t.doneOn)
      .sort((a, b) => (b.doneOn || 0) - (a.doneOn || 0))
      .slice(0, 10),
  );
}
