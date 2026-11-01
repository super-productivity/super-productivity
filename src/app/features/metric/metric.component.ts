import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChartConfiguration, ChartType } from 'chart.js';
import { MetricService } from './metric.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { T } from '../../t.const';
import { ProjectMetricsService } from './project-metrics.service';
import { AllTasksMetricsService } from './all-tasks-metrics.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { LazyChartComponent } from './lazy-chart/lazy-chart.component';
import { DecimalPipe } from '@angular/common';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ActivityHeatmapComponent } from './activity-heatmap/activity-heatmap.component';
import { ShareButtonComponent } from '../../core/share/share-button/share-button.component';
import { ShareFormatter } from '../../core/share/share-formatter';
import { SharePayload } from '../../core/share/share.model';
import { TODAY_TAG } from '../tag/tag.const';
import { LocaleDatePipe } from '../../ui/pipes/locale-date.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { LineChartData } from './metric.model';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

type LineChartOptions = ChartConfiguration<
  'line',
  (number | undefined)[],
  string
>['options'];
type LineScaleOptions = NonNullable<NonNullable<LineChartOptions>['scales']>['y'];

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
    LocaleDatePipe,
  ],
})
export class MetricComponent {
  workContextService = inject(WorkContextService);
  metricService = inject(MetricService);
  projectMetricsService = inject(ProjectMetricsService);
  allTasksMetricsService = inject(AllTasksMetricsService);
  private readonly _translateService = inject(TranslateService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);
  // Passed to the pure `localeDate` pipe so dates re-render on a locale change.
  readonly locale = this._dateTimeFormatService.currentLocale;
  private readonly _langChange = toSignal(this._translateService.onLangChange, {
    initialValue: null,
  });

  T: typeof T = T;

  activeWorkContext = toSignal(this.workContextService.activeWorkContext$);

  /**
   * Whether the active work context is the global "Today / all tasks" view.
   * Drives the metrics service selection (AllTasks vs Project), the view title,
   * and whether the global charts are shown (global charts only make sense in Today).
   */
  isShowingAllTasks = computed(() => {
    const context = this.activeWorkContext();
    return context?.type === WorkContextType.TAG && context.id === TODAY_TAG.id;
  });

  /**
   * Dynamic title that changes based on context
   */
  metricsTitle = computed(() => {
    return this.isShowingAllTasks() ? this.T.PM.ALL_TASKS_TITLE : this.T.PM.TITLE;
  });

  private readonly _simpleClickCounterData = toSignal(
    this.metricService.getSimpleClickCounterMetrics$(),
  );
  private readonly _simpleCounterStopWatchData = toSignal(
    this.metricService.getSimpleCounterStopwatchMetrics$(),
  );
  private readonly _focusSessionData = toSignal(
    this.metricService.getFocusSessionMetrics$(),
  );
  private readonly _evaluationData = toSignal(this.metricService.getEvaluationMetrics$());

  // Counter series are named by the user, so only their day labels are localized.
  simpleClickCounterData = computed(() =>
    this._localizeChartData(this._simpleClickCounterData(), false),
  );
  simpleCounterStopWatchData = computed(() =>
    this._localizeChartData(this._simpleCounterStopWatchData(), false),
  );
  focusSessionData = computed(() =>
    this._localizeChartData(this._focusSessionData(), true),
  );
  evaluationData = computed(() => this._localizeChartData(this._evaluationData(), true));

  clickCounterChartOptions = computed(() =>
    this._buildLineChartOptions(T.F.METRIC.CMP.CHART_Y_COUNT),
  );
  stopWatchChartOptions = computed(() =>
    this._buildLineChartOptions(T.F.METRIC.CMP.CHART_Y_MINUTES),
  );
  focusSessionChartOptions = computed(() => this._buildLineChartOptions());
  // Fixed 0-4 axis so the 1-4 impact and 1-3 energy ratings read on the same scale.
  evaluationChartOptions = computed(() =>
    this._buildLineChartOptions(T.F.METRIC.CMP.CHART_Y_RATING, {
      min: 0,
      max: 4,
      ticks: { stepSize: 1 },
    }),
  );
  lineChartType: ChartType = 'line';

  /**
   * Simple metrics signal that switches between AllTasksMetricsService and ProjectMetricsService
   * based on the current context
   */
  simpleMetrics = computed(() => {
    return this.isShowingAllTasks()
      ? this.allTasksMetricsService.simpleMetrics()
      : this.projectMetricsService.simpleMetrics();
  });

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

  private _localizeChartData(
    chart: LineChartData | undefined,
    isTranslateDatasetLabels: boolean,
  ): LineChartData | undefined {
    if (!chart) return chart;
    this._langChange();
    const locale = this.locale();
    return {
      ...chart,
      labels: chart.labels?.map((day) =>
        this._dateTimeFormatService.formatDate(dateStrToUtcDate(day), locale),
      ),
      datasets: isTranslateDatasetLabels
        ? chart.datasets.map((dataset) => ({
            ...dataset,
            label: dataset.label && this._translateService.instant(dataset.label),
          }))
        : chart.datasets,
    };
  }

  private _buildLineChartOptions(
    yTitleKey?: string,
    yScale: LineScaleOptions = { ticks: { precision: 0 } },
  ): LineChartOptions {
    this._langChange();
    return {
      responsive: true,
      scales: {
        x: {
          title: {
            display: true,
            text: this._translateService.instant(T.F.METRIC.CMP.CHART_X_DAY),
          },
        },
        y: {
          ...yScale,
          ...(yTitleKey && {
            title: { display: true, text: this._translateService.instant(yTitleKey) },
          }),
        },
      },
    };
  }
}
