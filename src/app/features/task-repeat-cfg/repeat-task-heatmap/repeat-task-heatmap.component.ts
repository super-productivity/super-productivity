import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../../tasks/task.service';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { from } from 'rxjs';
import { filter, first, switchMap } from 'rxjs/operators';
import { Task } from '../../tasks/task.model';
import { DateAdapter } from '@angular/material/core';
import { DayData, HeatmapViewData } from '../../../ui/heatmap/heatmap.component';
import { HeatmapSwitcherComponent } from '../../../ui/heatmap/heatmap-switcher.component';
import {
  buildHeatmapMonths,
  buildHeatmapWeeks,
  heatmapHoursTotal,
} from '../../../ui/heatmap/build-heatmap-data.util';
import { T } from '../../../t.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TranslateModule } from '@ngx-translate/core';
import { calcRepeatTaskSeriesTimeSpent } from '../calc-repeat-task-series-time-spent.util';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getRRuleOccurrencesInRange, isRRuleValid } from '../store/rrule-occurrence.util';
import { getEffectiveRepeatStartDate } from '../store/get-effective-repeat-start-date.util';
import { isRRuleEngineEnabled } from '../../config/rrule-engine-flag';
import { nextYearOf, prevYearOf } from '../../../ui/heatmap/year-nav.util';

@Component({
  selector: 'repeat-task-heatmap',
  templateUrl: './repeat-task-heatmap.component.html',
  styleUrls: ['./repeat-task-heatmap.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [HeatmapSwitcherComponent, TranslateModule],
})
export class RepeatTaskHeatmapComponent {
  readonly T = T;
  private readonly _taskService = inject(TaskService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);

  readonly repeatCfgId = input.required<string>();

  private readonly _loadedTasks = toSignal(
    toObservable(this.repeatCfgId).pipe(
      filter((id): id is string => !!id),
      switchMap((repeatCfgId) => from(this._loadTasksForRepeatCfg(repeatCfgId))),
    ),
    { initialValue: null },
  );

  // The cfg itself — drives the projected future occurrences (Phase 2). The
  // overlay is only rendered when the RRULE engine flag is on; otherwise the
  // heatmap stays the history-only view.
  private readonly _loadedCfg = toSignal(
    toObservable(this.repeatCfgId).pipe(
      filter((id): id is string => !!id),
      switchMap((repeatCfgId) =>
        this._taskRepeatCfgService.getTaskRepeatCfgById$(repeatCfgId).pipe(first()),
      ),
    ),
    { initialValue: null },
  );

  // Year filter: navigate the series one calendar year at a time. Years with
  // tracked data are reachable; the current year joins them only when the
  // projection overlay can put marks on it (else it's just an empty view).
  private readonly _userSelectedYear = signal<number | null>(null);
  readonly selectedYear = computed<number>(() => {
    const sel = this._userSelectedYear();
    const years = this.availableYears();
    if (sel !== null && years.includes(sel)) {
      return sel;
    }
    // Default to the newest year that actually renders something — a cfg whose
    // only history is in older years must not open on an empty current year
    // with the nav gone (that made the existing history unreachable).
    return years[0] ?? new Date().getFullYear();
  });
  readonly availableYears = computed<number[]>(() => {
    const years = new Set<number>();
    for (const task of this._loadedTasks() ?? []) {
      // Zero-value entries (start/stop tracking instantly) don't make a year's
      // heatmap render (`hasData` needs timeSpent > 0) — offering such a year
      // here would navigate to an empty view with no way back.
      for (const [dateStr, timeSpent] of Object.entries(task.timeSpentOnDay ?? {})) {
        const y = +dateStr.slice(0, 4);
        if (y && timeSpent > 0) {
          years.add(y);
        }
      }
    }
    const cfg = this._loadedCfg();
    if (
      years.size === 0 ||
      (!!cfg && isRRuleEngineEnabled() && !!cfg.rrule && isRRuleValid(cfg.rrule))
    ) {
      years.add(new Date().getFullYear());
    }
    return [...years].sort((a, b) => b - a);
  });
  readonly canPrevYear = computed(
    () => prevYearOf(this.availableYears(), this.selectedYear()) !== null,
  );
  readonly canNextYear = computed(
    () => nextYearOf(this.availableYears(), this.selectedYear()) !== null,
  );
  prevYear(): void {
    const y = prevYearOf(this.availableYears(), this.selectedYear());
    if (y !== null) {
      this._userSelectedYear.set(y);
    }
  }
  nextYear(): void {
    const y = nextYearOf(this.availableYears(), this.selectedYear());
    if (y !== null) {
      this._userSelectedYear.set(y);
    }
  }

  private readonly _rawHeatmapData = computed(() => {
    const tasks = this._loadedTasks();
    return tasks
      ? this._buildHeatmapData(tasks, this._loadedCfg(), this.selectedYear())
      : null;
  });

  readonly formattedTimeSummary = computed(() => {
    const tasks = this._loadedTasks();
    if (!tasks || tasks.length === 0) {
      return null;
    }
    const summary = calcRepeatTaskSeriesTimeSpent(tasks);
    return {
      total: msToString(summary.total),
      thisWeek: msToString(summary.thisWeek),
      thisMonth: msToString(summary.thisMonth),
    };
  });

  readonly heatmapData = computed<HeatmapViewData | null>(() => {
    const rawData = this._rawHeatmapData();
    const firstDay = this._dateAdapter.getFirstDayOfWeek();

    if (!rawData || !rawData.dayMap) {
      return null;
    }

    // Hide an all-empty heatmap only when there is nowhere else to navigate —
    // with other years available, returning null would tear down the switcher
    // INCLUDING its year nav and strand the user (an empty grid keeps the way
    // back open).
    if (!rawData.hasData && this.availableYears().length <= 1) {
      return null;
    }

    const monthNames = this._dateAdapter.getMonthNames('short');
    return {
      ...buildHeatmapWeeks(
        rawData.dayMap,
        rawData.startDate,
        rawData.endDate,
        firstDay,
        monthNames,
      ),
      months: buildHeatmapMonths(
        rawData.dayMap,
        rawData.startDate,
        rawData.endDate,
        firstDay,
        monthNames,
        heatmapHoursTotal,
      ),
      dayMap: rawData.dayMap,
      rangeStart: rawData.startDate,
      rangeEnd: rawData.endDate,
    };
  });

  private async _loadTasksForRepeatCfg(repeatCfgId: string): Promise<Task[]> {
    const [archive, currentTasks] = await Promise.all([
      this._taskArchiveService.load(),
      this._taskService.allTasks$.pipe(first()).toPromise(),
    ]);

    const matchingTasks: Task[] = [];

    // Filter current tasks by repeatCfgId
    if (currentTasks) {
      for (const task of currentTasks) {
        if (task.repeatCfgId === repeatCfgId) {
          matchingTasks.push(task);
        }
      }
    }

    // Filter archived tasks by repeatCfgId
    if (archive && archive.ids) {
      for (const taskId of archive.ids) {
        const archivedTask = archive.entities[taskId];
        if (archivedTask && archivedTask.repeatCfgId === repeatCfgId) {
          matchingTasks.push(archivedTask as Task);
        }
      }
    }

    return matchingTasks;
  }

  private _buildHeatmapData(
    tasks: Task[],
    cfg: TaskRepeatCfg | null | undefined,
    year: number,
  ): {
    dayMap: Map<string, DayData>;
    startDate: Date;
    endDate: Date;
    hasData: boolean;
  } {
    const dayMap = new Map<string, DayData>();
    const now = new Date();
    // One calendar year per view (the year filter navigates) — this also keeps
    // every month label unambiguous (no two "Jun" blocks from different years).
    const yearStart = new Date(year, 0, 1);
    const horizon = new Date(year, 11, 31);

    // Overlay upcoming occurrences on the selected year's remaining days, only
    // when the RRULE engine is enabled AND the cfg has a valid rrule — i.e. only
    // when the engine actually drives task creation (mirrors the routing utils'
    // `rrule && isRRuleValid` gate). Legacy cfgs are NOT projected via the
    // rrule converter: it diverges from the legacy engine for WEEKLY interval≥2
    // (rolling 7-day blocks vs WKST weeks) and zero-weekday cfgs, and a wrong
    // overlay is worse than none. With the flag off the heatmap is the
    // unchanged history-only view.
    const isProjecting =
      !!cfg && isRRuleEngineEnabled() && !!cfg.rrule && isRRuleValid(cfg.rrule);

    // Initialize all days of the selected year.
    const currentDate = new Date(yearStart);
    while (currentDate <= horizon) {
      const dateStr = getDbDateStr(currentDate);
      dayMap.set(dateStr, {
        date: new Date(currentDate),
        dateStr,
        taskCount: 0,
        timeSpent: 0,
        level: 0,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Aggregate time spent from all tasks
    let maxTime = 0;
    let hasData = false;
    const taskCountPerDay = new Map<string, Set<string>>();

    for (const task of tasks) {
      if (task.timeSpentOnDay) {
        for (const dateStr of Object.keys(task.timeSpentOnDay)) {
          const timeSpent = task.timeSpentOnDay[dateStr];
          const dayData = dayMap.get(dateStr);

          if (dayData && timeSpent > 0) {
            dayData.timeSpent += timeSpent;
            maxTime = Math.max(maxTime, dayData.timeSpent);
            hasData = true;

            // Track unique tasks per day
            if (!taskCountPerDay.has(dateStr)) {
              taskCountPerDay.set(dateStr, new Set());
            }
            taskCountPerDay.get(dateStr)!.add(task.id);
          }
        }
      }
    }

    // Update task counts
    for (const [dateStr, taskIds] of taskCountPerDay) {
      const dayData = dayMap.get(dateStr);
      if (dayData) {
        dayData.taskCount = taskIds.size;
      }
    }

    // Calculate levels (0-4) based on time spent
    for (const day of dayMap.values()) {
      if (day.timeSpent === 0) {
        day.level = 0;
      } else {
        const timeRatio = maxTime > 0 ? day.timeSpent / maxTime : 0;

        if (timeRatio > 0.75) {
          day.level = 4;
        } else if (timeRatio > 0.5) {
          day.level = 3;
        } else if (timeRatio > 0.25) {
          day.level = 2;
        } else {
          day.level = 1;
        }
      }
    }

    // Overlay the schedule (Phase 2). Per-instance overrides (moves/RDATE) are
    // Phase 8 — here only EXDATE skips apply. Occurrences are computed over the
    // WHOLE selected year: days after today render as projected upcoming
    // occurrences; past occurrence days stay as they are (filled when tracked,
    // level-0 when genuinely missed).
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (isProjecting && cfg && cfg.rrule) {
      const occurrences = getRRuleOccurrencesInRange(
        {
          rrule: cfg.rrule,
          // For a from-completion schedule this anchors past occurrences at the
          // CURRENT effective start — a best-effort reading of history, since
          // every completion re-anchored the series along the way.
          startDate: getEffectiveRepeatStartDate(cfg),
          exdates: cfg.deletedInstanceDates ?? [],
        },
        yearStart,
        horizon,
      );
      const scheduledDays = new Set<string>();
      for (const occ of occurrences) {
        const dateStr = getDbDateStr(occ);
        scheduledDays.add(dateStr);
        const dayData = dayMap.get(dateStr);
        // Future occurrences become the projected overlay — but never override
        // a day that already has real tracked activity.
        if (dayData && dayData.timeSpent === 0 && occ >= tomorrow) {
          dayData.isProjected = true;
          dayData.level = 1;
          hasData = true;
        }
      }
      // Days the task is NOT scheduled on (and that carry no tracked time)
      // disappear from the map entirely: the grid renders them as transparent
      // placeholder cells in the SAME position, so the visible cells read as
      // the actual streak — a weekly task no longer shows six grey "missed"
      // cells per week. Genuinely missed occurrence days stay grey.
      for (const [dateStr, day] of dayMap) {
        if (day.timeSpent === 0 && !day.isProjected && !scheduledDays.has(dateStr)) {
          dayMap.delete(dateStr);
        }
      }
    }

    return {
      dayMap,
      startDate: yearStart,
      endDate: horizon,
      hasData,
    };
  }
}
