import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectTasksWorkedOnOrDoneFlat } from '../../tasks/store/task.selectors';
import { getTodayStr } from '../../tasks/util/get-today-str';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';

@Component({
  selector: 'today-summary-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MsToStringPipe],
  template: `
    <div class="stats">
      <div class="stat">
        <div class="stat-value">{{ doneCount() }}/{{ totalCount() }}</div>
        <div class="stat-label">Tasks done</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ timeSpent() | msToString }}</div>
        <div class="stat-label">Time tracked</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ timeEstimated() | msToString }}</div>
        <div class="stat-label">Estimated</div>
      </div>
    </div>
    @if (totalCount() > 0) {
      <div class="progress-bar">
        <div
          class="progress-fill"
          [style.width.%]="progressPct()"
        ></div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        padding: var(--s2);
        height: 100%;
        justify-content: center;
      }

      .stats {
        display: flex;
        gap: var(--s3);
        justify-content: space-around;
      }

      .stat {
        text-align: center;
      }

      .stat-value {
        font-size: 1.4em;
        font-weight: 500;
      }

      .stat-label {
        font-size: 0.85em;
        opacity: 0.6;
        margin-top: var(--s-half);
      }

      .progress-bar {
        margin-top: var(--s2);
        height: 6px;
        border-radius: 3px;
        background: var(--divider-color);
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        border-radius: 3px;
        background: var(--color-primary);
        transition: width 0.3s ease;
      }
    `,
  ],
})
export class TodaySummaryWidgetComponent {
  private _store = inject(Store);
  private _todayStr = getTodayStr();

  todayTasks = toSignal(
    this._store.select(selectTasksWorkedOnOrDoneFlat, { day: this._todayStr }),
    { initialValue: [] as any[] },
  );

  doneCount = computed(() => (this.todayTasks() || []).filter((t) => t.isDone).length);
  totalCount = computed(() => (this.todayTasks() || []).length);
  timeSpent = computed(() =>
    (this.todayTasks() || []).reduce(
      (sum, t) => sum + (t.timeSpentOnDay?.[this._todayStr] || 0),
      0,
    ),
  );
  timeEstimated = computed(() =>
    (this.todayTasks() || []).reduce((sum, t) => sum + (t.timeEstimate || 0), 0),
  );
  progressPct = computed(() => {
    const total = this.totalCount();
    return total > 0 ? Math.round((this.doneCount() / total) * 100) : 0;
  });
}
