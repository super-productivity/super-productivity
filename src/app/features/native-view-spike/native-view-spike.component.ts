// SPIKE: throwaway, do not merge
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { BoardComponent } from '../boards/board/board.component';
import { PlannerDayComponent } from '../planner/planner-day/planner-day.component';
import { PlannerService } from '../planner/planner.service';
import { selectAllTasksDueToday } from '../planner/store/planner.selectors';
import { LazyChartComponent } from '../metric/lazy-chart/lazy-chart.component';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { DateService } from '../../core/date/date.service';
import { selectAllTasksInActiveProjects } from '../tasks/store/task.selectors';
import { selectUnarchivedProjects } from '../project/store/project.selectors';
import { selectActiveContextTypeAndId } from '../work-context/store/work-context.selectors';
import { BoardCfg } from '../boards/boards.model';
import { SPIKE_VIEW } from './spike-view.model';
import {
  columnsToBoardCfg,
  remainingMs,
  scopeOfContext,
  timePerProject,
} from './spike-view.util';

/**
 * Renders SPIKE_VIEW with SP's own components. `?persistOrder=1` keeps the
 * stock board behaviour (a persistent BOARD op per reorder) for comparison.
 */
@Component({
  selector: 'native-view-spike',
  imports: [
    NgTemplateOutlet,
    CdkDropListGroup,
    BoardComponent,
    PlannerDayComponent,
    LazyChartComponent,
    MsToStringPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ view.title }}</h2>
    <ng-container *ngTemplateOutlet="node; context: { $implicit: view.root }" />

    <ng-template
      #node
      let-id
    >
      @let c = view.components[id];
      @switch (c.type) {
        @case ('stack') {
          <div class="stack">
            @for (child of c.children; track child) {
              <ng-container *ngTemplateOutlet="node; context: { $implicit: child }" />
            }
          </div>
        }
        @case ('columns') {
          <div class="columns">
            @for (child of c.children; track child) {
              <ng-container *ngTemplateOutlet="node; context: { $implicit: child }" />
            }
          </div>
        }
        @case ('metric') {
          <section data-spike="metric">
            <h3>{{ c.title }}</h3>
            <p class="metric">{{ remaining() | msToString }}</p>
          </section>
        }
        @case ('timeBreakdown') {
          <section data-spike="time">
            <h3>{{ c.title }}</h3>
            <lazy-chart
              type="bar"
              height="200px"
              [legend]="false"
              [labels]="time().labels"
              [datasets]="[
                { label: 'Hours', data: time().hours, backgroundColor: time().colors },
              ]"
            />
          </section>
        }
        @case ('board') {
          <section data-spike="board">
            <h3>{{ c.title }}</h3>
            <!-- board needs a bounded height and a cdkDropListGroup host, as in boards.component.html -->
            <div class="board-frame">
              <board
                cdkDropListGroup
                [boardCfg]="boardCfgs()[id]"
                [isEphemeral]="!isPersistOrder"
              />
            </div>
          </section>
        }
        @case ('agenda') {
          <section data-spike="agenda">
            <h3>{{ c.title }}</h3>
            <div
              class="agenda"
              cdkDropListGroup
            >
              @for (day of days(); track day.dayDate) {
                <planner-day [day]="day" />
              }
            </div>
          </section>
        }
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      padding: var(--s2);
    }
    .stack {
      display: grid;
      gap: var(--s2);
    }
    .columns,
    .agenda {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: var(--s2);
    }
    .board-frame {
      height: 420px;
    }
    .metric {
      font-size: 2rem;
      margin: 0;
    }
  `,
})
export class NativeViewSpikeComponent {
  private readonly _store = inject(Store);
  private readonly _dateService = inject(DateService);
  private readonly _plannerService = inject(PlannerService);

  readonly view = SPIKE_VIEW;
  readonly isPersistOrder =
    inject(ActivatedRoute).snapshot.queryParamMap.has('persistOrder');

  // The "active" context is whatever the user last opened; this route has none of its own.
  private readonly _context = this._store.selectSignal(selectActiveContextTypeAndId);

  readonly boardCfgs = computed<Record<string, BoardCfg>>(() => {
    const { activeType, activeId } = this._context();
    const scope = scopeOfContext(activeType, activeId);
    const cfgs: Record<string, BoardCfg> = {};
    for (const [id, c] of Object.entries(this.view.components)) {
      if (c.type === 'board') {
        cfgs[id] = columnsToBoardCfg(id, c.title ?? '', c.columns ?? [], scope);
      }
    }
    return cfgs;
  });

  private readonly _agendaDays = this._dayStrs(this.view.components['agenda'].days, 1);
  readonly days = toSignal(this._plannerService.getDays$(this._agendaDays), {
    initialValue: [],
  });

  private readonly _dueToday = this._store.selectSignal(selectAllTasksDueToday);
  readonly remaining = computed(() => remainingMs(this._dueToday()));

  private readonly _timeRangeDays = this._dayStrs(
    this.view.components['time'].rangeDays,
    -1,
  );
  private readonly _allTasks = this._store.selectSignal(selectAllTasksInActiveProjects);
  private readonly _projects = this._store.selectSignal(selectUnarchivedProjects);
  readonly time = computed(() =>
    timePerProject(this._allTasks(), this._projects(), this._timeRangeDays),
  );

  /** Logical-day strings from today, stepping `step` days (1 forward, -1 back). */
  private _dayStrs(count: number | undefined, step: 1 | -1): string[] {
    const cursor = this._dateService.getLogicalTodayDate();
    // Midday is never inside a DST gap, so setDate() cannot skip a date.
    cursor.setHours(12, 0, 0, 0);
    return Array.from({ length: count ?? 1 }, () => {
      const dayStr = this._dateService.todayStr(cursor);
      cursor.setDate(cursor.getDate() + step);
      return dayStr;
    });
  }
}
