import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';
import { MetricService } from './metric.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { T } from '../../t.const';
import { ProjectMetricsService } from './project-metrics.service';
import { AllTasksMetricsService } from './all-tasks-metrics.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { LazyChartComponent } from './lazy-chart/lazy-chart.component';
import { DecimalPipe, CommonModule } from '@angular/common';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { ActivityHeatmapComponent } from './activity-heatmap/activity-heatmap.component';
import { ShareButtonComponent } from '../../core/share/share-button/share-button.component';
import { ShareFormatter } from '../../core/share/share-formatter';
import { SharePayload } from '../../core/share/share.model';
import { map, switchMap, filter } from 'rxjs/operators';
import { calculateSustainabilityScore } from './metric-scoring.util';
import { TODAY_TAG } from '../tag/tag.const';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { ProjectService } from '../project/project.service';
import { calculateProjectProgress } from './metric.util';
import { ProjectProgress } from './metric.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { ProgressBarComponent } from '../../ui/progress-bar/progress-bar.component';

const FULL_PRODUCTIVITY_BREAKDOWN_CHART_RANGE = Number.MAX_SAFE_INTEGER;

@Component({
  selector: 'metric',
  templateUrl: './metric.component.html',
  styleUrls: ['./metric.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation],
  imports: [
    LazyChartComponent,
    DecimalPipe,
    MsToStringPipe,
    TranslatePipe,
    ActivityHeatmapComponent,
    ShareButtonComponent,
    MatExpansionModule,
    MatIconModule,
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    ProgressBarComponent,
  ],
})
export class MetricComponent {
  workContextService = inject(WorkContextService);
  metricService = inject(MetricService);
  projectMetricsService = inject(ProjectMetricsService);
  allTasksMetricsService = inject(AllTasksMetricsService);
  private _projectService = inject(ProjectService);

  T: typeof T = T;

  expandedTaskIds = signal<Record<string, boolean>>({});
  timelineExpanded = signal(false);

  editingStartDate = signal(false);
  editingDeadline = signal(false);
  editStartDateValue = signal<Date | null>(null);
  editDeadlineValue = signal<Date | null>(null);
  editDurationValue = signal<number | null>(null);
  useDurationMode = signal(false);

  toggleTask(taskId: string): void {
    this.expandedTaskIds.update((val) => ({
      ...val,
      [taskId]: !val[taskId],
    }));
  }

  activeWorkContext = toSignal(this.workContextService.activeWorkContext$);

  /**
   * Determine which metrics service to use based on the active work context.
   * - For TODAY_TAG: use AllTasksMetricsService (shows all tasks)
   * - For other contexts: use ProjectMetricsService (project/tag specific)
   */
  private _isShowingAllTasks = computed(() => {
    const context = this.activeWorkContext();
    return context?.type === WorkContextType.TAG && context.id === TODAY_TAG.id;
  });

  /**
   * Dynamic title that changes based on context
   */
  metricsTitle = computed(() => {
    return this._isShowingAllTasks() ? this.T.PM.ALL_TASKS_TITLE : this.T.PM.TITLE;
  });

  simpleClickCounterData = toSignal(this.metricService.getSimpleClickCounterMetrics$());

  simpleCounterStopWatchData = toSignal(
    this.metricService.getSimpleCounterStopwatchMetrics$(),
  );

  focusSessionData = toSignal(this.metricService.getFocusSessionMetrics$());

  productivityBreakdownChartData = toSignal<ChartData<
    'line',
    (number | null)[],
    string
  > | null>(
    this.metricService
      .getProductivityBreakdown$(FULL_PRODUCTIVITY_BREAKDOWN_CHART_RANGE)
      .pipe(
        map((breakdown) => {
          if (!breakdown.length) {
            return null;
          }

          const labels = breakdown.map((item) => item.day);
          const productivityScores = breakdown.map((item) =>
            item.score != null ? item.score : null,
          );
          const sustainabilityScores = breakdown.map((item) =>
            item.energyCheckin != null
              ? calculateSustainabilityScore(
                  item.focusedMinutes,
                  item.totalWorkMinutes,
                  600,
                  item.energyCheckin,
                )
              : null,
          );

          const hasData =
            productivityScores.some((score) => score != null) ||
            sustainabilityScores.some((score) => score != null);

          if (!hasData) {
            return null;
          }

          return {
            labels,
            datasets: [
              {
                label: 'Productivity Score',
                data: productivityScores,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1,
              },
              {
                label: 'Sustainability Score',
                data: sustainabilityScores,
                borderColor: 'rgb(153, 102, 255)',
                backgroundColor: 'rgba(153, 102, 255, 0.2)',
                tension: 0.1,
              },
            ],
          } as ChartData<'line', (number | null)[], string>;
        }),
      ),
    { initialValue: null },
  );

  lineChartOptions: ChartConfiguration<
    'line',
    (number | undefined)[],
    string
  >['options'] = {
    responsive: true,
    scales: {
      y: {
        ticks: {
          precision: 0,
        },
      },
    },
  };
  lineChartType: ChartType = 'line';

  /**
   * Simple metrics signal that switches between AllTasksMetricsService and ProjectMetricsService
   * based on the current context
   */
  simpleMetrics = computed(() => {
    return this._isShowingAllTasks()
      ? this.allTasksMetricsService.simpleMetrics()
      : this.projectMetricsService.simpleMetrics();
  });

  private _activeProject = toSignal(
    toObservable(this.activeWorkContext).pipe(
      filter((ctx) => !!ctx && ctx.type === WorkContextType.PROJECT),
      switchMap((ctx) => this._projectService.getByIdLive$(ctx!.id)),
      filter((p) => !!p),
    ),
  );

  projectProgress = computed<ProjectProgress | null>(() => {
    const sm = this.simpleMetrics();
    const project = this._activeProject();
    if (!sm || !project || this._isShowingAllTasks()) return null;
    const hasDeadline = !!(project.targetDate || project.targetDuration);
    if (!hasDeadline) return null;
    return calculateProjectProgress(
      sm,
      project.targetStartDate,
      project.targetDate,
      project.targetDuration,
    );
  });

  isProjectWithTasks = computed(() => {
    const sm = this.simpleMetrics();
    const project = this._activeProject();
    return !!sm && !!project && !this._isShowingAllTasks() && sm.nrOfAllTasks > 0;
  });

  saveProjectDates(): void {
    const project = this._activeProject();
    if (!project) return;

    const changes: any = {};
    const sm = this.simpleMetrics();
    const startDateObj = this.editStartDateValue();
    const deadlineDateObj = this.editDeadlineValue();
    const durationVal = this.editDurationValue();

    const startDateStr = startDateObj
      ? getDbDateStr(startDateObj.getTime())
      : project.targetStartDate || sm?.actualStart || sm?.start || undefined;
    if (startDateStr) {
      changes.targetStartDate = startDateStr;
    }

    const isUnconfigured = this._isUnconfigured();
    if (isUnconfigured) {
      if (durationVal) {
        changes.targetDuration = durationVal;
        changes.targetDate = null;
      } else if (deadlineDateObj) {
        changes.targetDate = getDbDateStr(deadlineDateObj.getTime());
        changes.targetDuration = null;
      }
    } else if (this.editingDeadline()) {
      if (this.useDurationMode() && durationVal) {
        changes.targetDuration = durationVal;
        changes.targetDate = null;
      } else if (deadlineDateObj) {
        changes.targetDate = getDbDateStr(deadlineDateObj.getTime());
        changes.targetDuration = null;
      }
    }
    this._projectService.update(project.id, changes);
    this.editingStartDate.set(false);
    this.editingDeadline.set(false);
  }

  private _dateFromStr(dateStr?: string | null): Date | null {
    return dateStr ? new Date(dateStr + 'T00:00:00') : null;
  }

  private _isUnconfigured(): boolean {
    const project = this._activeProject();
    return !project?.targetDate && !project?.targetDuration;
  }

  startEditStartDate(): void {
    const sm = this.simpleMetrics();
    const project = this._activeProject();
    this.editStartDateValue.set(
      this._dateFromStr(project?.targetStartDate || sm?.actualStart || sm?.start),
    );
    this.editingStartDate.set(true);
  }

  startEditDeadline(): void {
    const project = this._activeProject();
    if (project?.targetDate) {
      this.editDeadlineValue.set(this._dateFromStr(project.targetDate));
      this.useDurationMode.set(false);
    } else if (project?.targetDuration) {
      this.editDurationValue.set(project.targetDuration);
      this.useDurationMode.set(true);
    } else {
      this.editDeadlineValue.set(null);
      this.editDurationValue.set(null);
      this.useDurationMode.set(false);
    }
    this.editingDeadline.set(true);
  }

  cancelEdit(): void {
    this.editingStartDate.set(false);
    this.editingDeadline.set(false);
  }

  sharePayload = computed<SharePayload>(() => {
    const sm = this.simpleMetrics();
    const workContext = this.activeWorkContext();

    if (!sm) {
      return ShareFormatter.formatPromotion();
    }

    return ShareFormatter.formatWorkSummary(
      {
        totalTimeSpent: sm.timeSpent,
        tasksCompleted: sm.nrOfCompletedTasks,
        dateRange: {
          start: sm.start,
          end: sm.end,
        },
        projectName: workContext?.title,
        detailedMetrics: {
          timeEstimate: sm.timeEstimate,
          totalTasks: sm.nrOfAllTasks,
          daysWorked: sm.daysWorked,
          avgTasksPerDay: sm.avgTasksPerDay,
          avgBreakNr: sm.avgBreakNr,
          avgTimeSpentOnDay: sm.avgTimeSpentOnDay,
          avgTimeSpentOnTask: sm.avgTimeSpentOnTask,
          avgTimeSpentOnTaskIncludingSubTasks: sm.avgTimeSpentOnTaskIncludingSubTasks,
          avgBreakTime: sm.avgBreakTime,
        },
      },
      {
        includeUTM: true,
        includeHashtags: true,
      },
    );
  });
}
