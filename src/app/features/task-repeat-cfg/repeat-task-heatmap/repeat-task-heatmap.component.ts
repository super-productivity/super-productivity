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
import { filter, first, map, switchMap } from 'rxjs/operators';
import { Task } from '../../tasks/task.model';
import { DateAdapter } from '@angular/material/core';
import {
  DayData,
  WeekData,
  HeatmapData,
  HeatmapComponent,
} from '../../../ui/heatmap/heatmap.component';

@Component({
  selector: 'repeat-task-heatmap',
  templateUrl: './repeat-task-heatmap.component.html',
  styleUrls: ['./repeat-task-heatmap.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [HeatmapComponent],
})
export class RepeatTaskHeatmapComponent {
  private readonly _taskService = inject(TaskService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _dateAdapter = inject(DateAdapter);

  readonly repeatCfgId = input.required<string>();

  private readonly _rawHeatmapData = toSignal(
    toObservable(this.repeatCfgId).pipe(
      filter((id): id is string => !!id),
      switchMap((repeatCfgId) => from(this._loadTasksForRepeatCfg(repeatCfgId))),
      map((tasks) => this._buildHeatmapData(tasks)),
    ),
    { initialValue: null },
  );

  readonly heatmapData = computed<HeatmapData | null>(() => {
    const rawData = this._rawHeatmapData();
    const firstDay = this._dateAdapter.getFirstDayOfWeek();

    if (!rawData || !rawData.dayMap) {
      return null;
    }

    // Check if there's any actual data
    if (!rawData.hasData) {
      return null;
    }

    return this._buildWeeksGrid(
      rawData.dayMap,
      rawData.startDate,
      rawData.endDate,
      firstDay,
    );
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

  private _buildHeatmapData(tasks: Task[]): {
    dayMap: Map<string, DayData>;
    startDate: Date;
    endDate: Date;
    hasData: boolean;
  } {
    const dayMap = new Map<string, DayData>();
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    // Initialize all days in the past year
    const currentDate = new Date(oneYearAgo);
    while (currentDate <= now) {
      const dateStr = this._getDateStr(currentDate);
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

    return {
      dayMap,
      startDate: oneYearAgo,
      endDate: now,
      hasData,
    };
  }

  private _getDateStr(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private _buildWeeksGrid(
    dayMap: Map<string, DayData>,
    startDate: Date,
    endDate: Date,
    firstDayOfWeek: number = 0,
  ): HeatmapData {
    const weeks: WeekData[] = [];
    const monthLabels: string[] = [];
    const monthNames = this._dateAdapter.getMonthNames('short');
    let currentMonth = -1;

    // Find the first day (based on firstDayOfWeek setting) before or on the start date
    const firstDay = new Date(startDate);
    const dayOfWeek = firstDay.getDay();
    const daysToGoBack = (dayOfWeek - firstDayOfWeek + 7) % 7;
    firstDay.setDate(firstDay.getDate() - daysToGoBack);

    // Build weeks
    const currentDate = new Date(firstDay);
    let weekCount = 0;

    while (currentDate <= endDate || weeks.length === 0) {
      const week: WeekData = { days: [] };

      for (let i = 0; i < 7; i++) {
        const dateStr = this._getDateStr(currentDate);
        const dayData = dayMap.get(dateStr);

        if (currentDate >= startDate && currentDate <= endDate) {
          week.days.push(dayData || null);

          const month = currentDate.getMonth();
          if (month !== currentMonth && currentDate.getDate() <= 7 && weekCount > 0) {
            monthLabels.push(monthNames[month]);
            currentMonth = month;
          } else if (monthLabels.length === 0 && weekCount === 0) {
            monthLabels.push(monthNames[month]);
            currentMonth = month;
          }
        } else {
          week.days.push(null);
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      weeks.push(week);
      weekCount++;

      if (weeks.length > 54) {
        break;
      }
    }

    return { weeks, monthLabels };
  }
}
