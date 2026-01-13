import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { WorklogService } from '../../worklog/worklog.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../../tasks/task.service';
import { TaskArchiveService } from '../../time-tracking/task-archive.service';
import { combineLatest, defer, from } from 'rxjs';
import { first, map, switchMap, tap } from 'rxjs/operators';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { TODAY_TAG } from '../../tag/tag.const';
import { Task } from '../../tasks/task.model';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconButton } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { SnackService } from '../../../core/snack/snack.service';
import { ShareService } from '../../../core/share/share.service';
import {
  DayData,
  WeekData,
  HeatmapComponent,
} from '../../../ui/heatmap/heatmap.component';
import { DateAdapter } from '@angular/material/core';

interface YearlyActivityData {
  dayMap: Map<string, DayData>;
  startDate: Date;
  endDate: Date;
}

@Component({
  selector: 'activity-heatmap',
  templateUrl: './activity-heatmap.component.html',
  styleUrls: ['./activity-heatmap.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HeatmapComponent,
    TranslatePipe,
    MatFormFieldModule,
    MatIconButton,
    MatSelectModule,
    MatTooltip,
    MatIcon,
  ],
})
export class ActivityHeatmapComponent {
  private readonly _worklogService = inject(WorklogService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _taskService = inject(TaskService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _snackService = inject(SnackService);
  private readonly _shareService = inject(ShareService);
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _userSelectedYear = signal<number | null>(null);
  availableYears = signal<number[]>([]);
  selectedYear = computed(() => {
    const userSelection = this._userSelectedYear();
    const availableYears = this.availableYears();
    // If user has made a selection and it's valid, use it
    if (userSelection !== null && availableYears.includes(userSelection)) {
      return userSelection;
    }
    // Otherwise, default to most recent year with data or the current year
    return availableYears.length > 0 ? availableYears[0] : new Date().getFullYear();
  });
  T: typeof T = T;
  weeks: WeekData[] = [];
  isSharing = signal(false);
  private readonly _activeWorkContextTitle = toSignal(
    this._workContextService.activeWorkContextTitle$,
    { initialValue: '' },
  );

  onYearChange(year: number): void {
    this._userSelectedYear.set(year); // Only update user selection
  }

  // Day labels adjusted for first day of week
  readonly dayLabels = computed(() => {
    const allDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    return [...allDays.slice(firstDay), ...allDays.slice(0, firstDay)];
  });

  // Raw data signals
  private readonly _rawHeatmapData = toSignal(
    combineLatest([
      this._workContextService.activeWorkContext$,
      toObservable(this.selectedYear), // Changes in selected year will trigger recalculation
    ]).pipe(
      switchMap(([context, selectedYear]) => {
        // Special case: TODAY tag shows ALL data from all tasks
        if (context.id === TODAY_TAG.id) {
          // Use defer to ensure the Promise is created fresh each time
          return defer(() => from(this._loadAllTasks())).pipe(
            tap((tasks) => {
              const yearsWithData = this._extractAvailableYears(tasks);
              this.availableYears.set(yearsWithData);
            }),
            map((tasks) => {
              const currentlySelectedYear = this.selectedYear();
              return this._buildHeatmapDataForGivenYear(tasks, currentlySelectedYear);
            }),
          );
        }

        // Normal case: use context-filtered worklog
        return this._worklogService.worklog$.pipe(
          tap((worklog) => {
            // Extract years from worklog and populate availableYears
            const yearsWithData = this._extractAvailableYearsFromWorklog(worklog);
            this.availableYears.set(yearsWithData);
          }),
          map((worklog) => {
            const currentlySelectedYear = this.selectedYear();
            return this._buildHeatmapDataFromWorklog(worklog, currentlySelectedYear);
          }),
        );
      }),
    ),
    { initialValue: null },
  );

  // Compute heatmap data - reacts to both data changes AND firstDayOfWeek setting changes
  heatmapData = computed(() => {
    const rawData = this._rawHeatmapData();
    const firstDay = this._dateAdapter.getFirstDayOfWeek();

    if (!rawData || !rawData.dayMap) {
      return null;
    }

    // Rebuild the weeks grid with the current firstDayOfWeek setting
    return this._buildWeeksGrid(
      rawData.dayMap,
      rawData.startDate,
      rawData.endDate,
      firstDay,
    );
  });

  private async _loadAllTasks(): Promise<Task[]> {
    // Load both current tasks and archived tasks
    const [archive, currentTasks] = await Promise.all([
      this._taskArchiveService.load(),
      this._taskService.allTasks$.pipe(first()).toPromise(),
    ]);

    const allTasks: Task[] = [...(currentTasks || [])];

    // Add archived tasks (archive is a single TaskArchive object with all tasks)
    if (archive && archive.ids) {
      archive.ids.forEach((taskId) => {
        const archivedTask = archive.entities[taskId];
        if (archivedTask) {
          allTasks.push(archivedTask as Task);
        }
      });
    }

    return allTasks;
  }

  private _buildHeatmapDataForGivenYear(
    tasks: Task[],
    year: number,
  ): YearlyActivityData | null {
    const dayMap = new Map<string, DayData>();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    // Initialize all days in the specified year
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
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

    // Extract time spent data for the specific year
    let maxTasks = 0;
    let maxTime = 0;
    const taskCountPerDay = new Map<string, Set<string>>();
    tasks.forEach((task) => {
      if (task.timeSpentOnDay) {
        Object.keys(task.timeSpentOnDay).forEach((dateStr) => {
          const dateYear = parseInt(dateStr.substring(0, 4), 10);
          if (dateYear !== year) return;
          const timeSpent = task.timeSpentOnDay[dateStr];
          const dayData = dayMap.get(dateStr);
          if (dayData && timeSpent > 0) {
            dayData.timeSpent += timeSpent;
            maxTime = Math.max(maxTime, dayData.timeSpent);
            // Track unique tasks per day
            if (!taskCountPerDay.has(dateStr)) {
              taskCountPerDay.set(dateStr, new Set());
            }
            taskCountPerDay.get(dateStr)!.add(task.id);
          }
        });
      }
    });

    // Update task counts
    taskCountPerDay.forEach((taskIds, dateStr) => {
      const dayData = dayMap.get(dateStr);
      if (dayData) {
        dayData.taskCount = taskIds.size;
        maxTasks = Math.max(maxTasks, dayData.taskCount);
      }
    });

    // Calculate activity levels
    dayMap.forEach((day) => {
      if (day.taskCount === 0 && day.timeSpent === 0) {
        day.level = 0;
      } else {
        const taskRatio = maxTasks > 0 ? day.taskCount / maxTasks : 0;
        const timeRatio = maxTime > 0 ? day.timeSpent / maxTime : 0;
        // eslint-disable-next-line no-mixed-operators
        const combinedRatio = timeRatio * 0.8 + taskRatio * 0.2;
        if (combinedRatio > 0.75) {
          day.level = 4;
        } else if (combinedRatio > 0.5) {
          day.level = 3;
        } else if (combinedRatio > 0.25) {
          day.level = 2;
        } else {
          day.level = 1;
        }
      }
    });
    return { dayMap, startDate, endDate };
  }

  private _buildHeatmapDataFromWorklog(
    worklog: any,
    year: number,
  ): {
    dayMap: Map<string, DayData>;
    startDate: Date;
    endDate: Date;
  } | null {
    if (!worklog) {
      return null;
    }
    // Day map contains properties for each day of the year, regardless
    // whether that day has any logged work or not
    const dayMap = new Map<string, DayData>();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    // Initialize all days in the specified year
    const curDate = new Date(startDate);
    while (curDate <= endDate) {
      const dateStr = this._getDateStr(curDate);
      dayMap.set(dateStr, {
        date: new Date(curDate),
        dateStr,
        taskCount: 0,
        timeSpent: 0,
        level: 0,
      });
      curDate.setDate(curDate.getDate() + 1);
    }

    // Extract data from worklog for the specified year
    let maxTasks = 0;
    let maxTime = 0;
    const yearData = worklog[year];
    if (yearData && yearData.ent) {
      Object.keys(yearData.ent).forEach((monthKey) => {
        const month = +monthKey;
        const monthData = yearData.ent[month];
        if (monthData && monthData.ent) {
          Object.keys(monthData.ent).forEach((dayKey) => {
            const day = +dayKey;
            const dayData = monthData.ent[day];
            if (day) {
              const dateStr = dayData.dateStr;
              const existing = dayMap.get(dateStr);
              if (existing) {
                const taskCount = dayData.logEntries.length;
                const timeSpent = dayData.timeSpent;
                existing.taskCount = taskCount;
                existing.timeSpent = timeSpent;
                maxTasks = Math.max(maxTasks, taskCount);
                maxTime = Math.max(maxTime, timeSpent);
              }
            }
          });
        }
      });
    }

    // Calculate levels
    dayMap.forEach((day) => {
      if (day.taskCount === 0 && day.timeSpent === 0) {
        day.level = 0;
      } else {
        const taskRatio = maxTasks > 0 ? day.taskCount / maxTasks : 0;
        const timeRatio = maxTime > 0 ? day.timeSpent / maxTime : 0;
        // eslint-disable-next-line no-mixed-operators
        const combinedRatio = timeRatio * 0.8 + taskRatio * 0.2;

        if (combinedRatio > 0.75) {
          day.level = 4;
        } else if (combinedRatio > 0.5) {
          day.level = 3;
        } else if (combinedRatio > 0.25) {
          day.level = 2;
        } else {
          day.level = 1;
        }
      }
    });
    return {
      dayMap,
      startDate,
      endDate,
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
  ): { weeks: WeekData[]; monthLabels: string[] } {
    const weeks: WeekData[] = [];
    const monthLabels: string[] = [];
    let currentMonth = -1;

    // Find the first day (based on firstDayOfWeek setting) before or on the start date
    const firstDay = new Date(startDate);
    const dayOfWeek = firstDay.getDay();
    // Calculate days to go back to reach the first day of the week
    const daysToGoBack = (dayOfWeek - firstDayOfWeek + 7) % 7;
    firstDay.setDate(firstDay.getDate() - daysToGoBack);

    // Build weeks
    const currentDate = new Date(firstDay);
    let weekCount = 0;

    while (currentDate <= endDate || weeks.length === 0) {
      const week: WeekData = { days: [] };

      // Add 7 days for this week
      for (let i = 0; i < 7; i++) {
        const dateStr = this._getDateStr(currentDate);
        const dayData = dayMap.get(dateStr);

        // Only include days within our range
        if (currentDate >= startDate && currentDate <= endDate) {
          week.days.push(dayData || null);

          // Track month changes for labels
          const month = currentDate.getMonth();
          if (month !== currentMonth && currentDate.getDate() <= 7 && weekCount > 0) {
            // Add month label at the start of the month
            const monthNames = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ];
            monthLabels.push(monthNames[month]);
            currentMonth = month;
          } else if (monthLabels.length === 0 && weekCount === 0) {
            // Add first month
            const monthNames = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ];
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

      // Safety limit
      if (weeks.length > 54) {
        break;
      }
    }

    return { weeks, monthLabels };
  }

  getDayClass(day: DayData | null): string {
    if (!day) {
      return 'day empty';
    }
    return `day level-${day.level}`;
  }

  getDayTitle(day: DayData | null): string {
    if (!day) {
      return '';
    }
    return `${day.dateStr}: ${day.taskCount} tasks, ${this._formatTime(day.timeSpent)}`;
  }

  private _formatTime(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private _extractAvailableYears(tasks: Task[]): number[] {
    const yearsSet = new Set<number>();
    const currentYear = new Date().getFullYear();
    tasks.forEach((task) => {
      if (task.timeSpentOnDay) {
        Object.keys(task.timeSpentOnDay).forEach((dateStr) => {
          const timeSpent = task.timeSpentOnDay[dateStr];
          if (timeSpent > 0) {
            // dateStr is in ISO format YYYY-MM-DD, so extract the
            // first four characters to get the year
            const year = parseInt(dateStr.substring(0, 4), 10);
            // Validate and collect year
            if (!isNaN(year) && year <= currentYear) {
              yearsSet.add(year);
            }
          }
        });
      }
    });
    // Sort years in descending order, i.e. latest years
    // come first so that they will be displayed first in the
    // select menu
    return Array.from(yearsSet).sort((a, b) => b - a);
  }

  private _extractAvailableYearsFromWorklog(worklog: any): number[] {
    if (!worklog) return [];
    const yearSet = new Set<number>();
    const curYear = new Date().getFullYear();
    Object.keys(worklog).forEach((key) => {
      const year = parseInt(key, 10);
      if (!isNaN(year) && year <= curYear) {
        // Check if this year has any data
        const yearData = worklog[year];
        if (yearData && yearData.ent && Object.keys(yearData.ent).length > 0) {
          yearSet.add(year);
        }
      }
    });
    return Array.from(yearSet).sort((a, b) => b - a);
  }

  async shareHeatmap(): Promise<void> {
    const data = this.heatmapData();
    if (!data) {
      return;
    }

    this.isSharing.set(true);

    try {
      // Render heatmap to canvas
      const contextTitle = this._activeWorkContextTitle();
      const canvas = this._renderToCanvas(data, contextTitle);

      const result = await this._shareService.shareCanvasImage({
        canvas,
        filename: 'activity-heatmap.png',
        shareTitle: 'Activity Heatmap',
      });

      if (result.success) {
        if (result.target === 'download') {
          const message = result.path
            ? `Heatmap saved to ${result.path}`
            : 'Heatmap saved to device storage';
          const canOpen = this._shareService.canOpenDownloadResult(result);
          const actionConfig = canOpen
            ? {
                actionStr: T.GLOBAL_SNACK.FILE_DOWNLOADED_BTN,
                actionFn: () => {
                  void this._shareService.openDownloadResult(result);
                },
              }
            : {};
          this._snackService.open({
            type: 'SUCCESS',
            msg: message,
            isSkipTranslate: true,
            ...actionConfig,
          });
        }
      } else if (result.error && result.error !== 'Share cancelled') {
        console.error('Share failed:', result.error);
        this._snackService.open({
          type: 'ERROR',
          msg: 'Failed to share heatmap',
        });
      }
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError' || error?.error === 'Share cancelled';
      if (!isAbort) {
        console.error('Share failed:', error);
        this._snackService.open({
          type: 'ERROR',
          msg: 'Failed to share heatmap',
        });
      }
    } finally {
      this.isSharing.set(false);
    }
  }

  private _renderToCanvas(
    data: {
      weeks: WeekData[];
      monthLabels: string[];
    },
    contextTitle: string,
  ): HTMLCanvasElement {
    const cellSize = 12;
    const gap = 2;
    const dayLabelWidth = 40;
    const monthLabelHeight = 20;
    const padding = 16;
    const weekHeight = 7 * (cellSize + gap);
    const doublePadding = padding * 2;
    const heatmapHeight = monthLabelHeight + weekHeight;
    const baseCanvasHeight = heatmapHeight + doublePadding;
    const taglineHeight = 32;

    // Calculate dimensions
    const numWeeks = data.weeks.length;
    const weeksWidth = numWeeks * (cellSize + gap);
    const canvasWidth = dayLabelWidth + weeksWidth + doublePadding;
    const canvasHeight = baseCanvasHeight + taglineHeight;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Day labels (Sun, Mon, etc.)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const dayNames = this.dayLabels();
    dayNames.forEach((day, i) => {
      // eslint-disable-next-line no-mixed-operators
      const y = padding + monthLabelHeight + i * (cellSize + gap) + cellSize / 2;
      ctx.fillText(day, padding + dayLabelWidth - 4, y);
    });

    // Month labels
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    data.monthLabels.forEach((month, i) => {
      // eslint-disable-next-line no-mixed-operators
      const x = padding + dayLabelWidth + i * 4 * (cellSize + gap);
      ctx.fillText(month, x, padding);
    });

    // Get primary color from CSS variable or use default
    const primaryColor =
      getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim() ||
      '#3f51b5';

    // Draw heatmap cells
    data.weeks.forEach((week, weekIndex) => {
      week.days.forEach((day, dayIndex) => {
        if (day) {
          // eslint-disable-next-line no-mixed-operators
          const x = padding + dayLabelWidth + weekIndex * (cellSize + gap);
          // eslint-disable-next-line no-mixed-operators
          const y = padding + monthLabelHeight + dayIndex * (cellSize + gap);

          // Set color based on level
          if (day.level === 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
          } else {
            // Mix primary color with transparency
            const opacity = day.level * 0.2; // 0.2, 0.4, 0.6, 0.8, 1.0
            ctx.fillStyle = this._mixColor(primaryColor, opacity);
          }

          // Draw rounded rectangle
          this._roundRect(ctx, x, y, cellSize, cellSize, 2);
        }
      });
    });

    const normalizedTitle = contextTitle?.trim().length
      ? contextTitle.trim()
      : 'Super Productivity';
    const shareLabel = `${normalizedTitle} – With the Super Productivity App`;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.font = '14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const taglineOffset = taglineHeight / 2;
    const taglineY = baseCanvasHeight + taglineOffset;
    ctx.fillText(shareLabel, canvasWidth / 2, taglineY);

    return canvas;
  }

  private _mixColor(color: string, opacity: number): string {
    // Simple color mixing - assumes hex or rgb color
    if (color.startsWith('#')) {
      // Convert hex to rgb
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    // Assume it's already in rgb/rgba format
    return color.replace(
      /rgba?\([^)]+\)/,
      `rgba(${color.match(/\d+/g)?.slice(0, 3).join(',')}, ${opacity})`,
    );
  }

  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }
}
