import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../../tasks/task.service';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { from } from 'rxjs';
import { filter, first, switchMap } from 'rxjs/operators';
import { Task } from '../../tasks/task.model';
import { DateAdapter } from '@angular/material/core';
import { DayData, HeatmapData } from '../../../ui/heatmap/heatmap.component';
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
import { getRRuleOccurrencesInRange } from '../store/rrule-occurrence.util';
import { legacyTaskRepeatCfgToRRule } from '../util/legacy-cfg-to-rrule.util';
import { getEffectiveRepeatStartDate } from '../store/get-effective-repeat-start-date.util';
import { isRRuleEngineEnabled } from '../../config/rrule-engine-flag';

// How far ahead the heatmap projects upcoming occurrences. Only applied when the
// RRULE engine flag is on (Phase 2); otherwise the heatmap stays the past-year
// history-only view it was before.
const PROJECTION_DAYS = 92;

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

  private readonly _rawHeatmapData = computed(() => {
    const tasks = this._loadedTasks();
    return tasks ? this._buildHeatmapData(tasks, this._loadedCfg()) : null;
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

  readonly heatmapData = computed<
    | (HeatmapData & { dayMap: Map<string, DayData>; rangeStart: Date; rangeEnd: Date })
    | null
  >(() => {
    const rawData = this._rawHeatmapData();
    const firstDay = this._dateAdapter.getFirstDayOfWeek();

    if (!rawData || !rawData.dayMap) {
      return null;
    }

    // Check if there's any actual data
    if (!rawData.hasData) {
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
  ): {
    dayMap: Map<string, DayData>;
    startDate: Date;
    endDate: Date;
    hasData: boolean;
  } {
    const dayMap = new Map<string, DayData>();
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    // Project a few months ahead only when the RRULE engine is enabled; with the
    // flag off the heatmap is the unchanged past-year history view.
    const isProjecting = !!cfg && isRRuleEngineEnabled();
    const horizon = new Date(now);
    if (isProjecting) {
      horizon.setDate(horizon.getDate() + PROJECTION_DAYS);
    }

    // Initialize all days from a year ago through the (possibly projected) end.
    const currentDate = new Date(oneYearAgo);
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

    // Overlay projected future occurrences (Phase 2). For legacy cfgs (no rrule)
    // derive an equivalent rule so the projection still works. Per-instance
    // overrides (moves/RDATE) are Phase 8 — here only EXDATE skips apply.
    if (isProjecting && cfg) {
      const rrule = cfg.rrule || legacyTaskRepeatCfgToRRule(cfg);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const occurrences = getRRuleOccurrencesInRange(
        {
          rrule,
          startDate: getEffectiveRepeatStartDate(cfg),
          exdates: cfg.deletedInstanceDates ?? [],
        },
        tomorrow,
        horizon,
      );
      for (const occ of occurrences) {
        const dayData = dayMap.get(getDbDateStr(occ));
        // Don't override a day that already has real tracked activity.
        if (dayData && dayData.timeSpent === 0) {
          dayData.isProjected = true;
          dayData.level = 1;
          hasData = true;
        }
      }
    }

    return {
      dayMap,
      startDate: oneYearAgo,
      endDate: horizon,
      hasData,
    };
  }
}
