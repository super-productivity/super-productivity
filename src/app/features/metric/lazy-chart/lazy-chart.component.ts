import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type {
  ActiveElement,
  Chart as ChartJS,
  ChartConfiguration,
  ChartData,
  ChartDataset,
  ChartEvent,
  ChartOptions,
  ChartType,
  DefaultDataPoint,
} from 'chart.js';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatRadioButton, MatRadioChange, MatRadioGroup } from '@angular/material/radio';
import { TranslatePipe } from '@ngx-translate/core';
import { ChartLazyLoaderService } from '../chart-lazy-loader.service';
import { ShareService } from '../../../core/share/share.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';

interface ChartClickEvent {
  active: ActiveElement[];
}

type LazyChartTimeframe = 'twoWeeks' | 'oneMonth' | 'max';

interface TimeframeOption {
  id: LazyChartTimeframe;
  labelKey: string;
  limit: number | null;
}

const TIMEFRAME_OPTIONS: ReadonlyArray<TimeframeOption> = [
  {
    id: 'twoWeeks',
    labelKey: T.F.METRIC.CMP.TIME_FRAME_2_WEEKS,
    limit: 14,
  },
  {
    id: 'oneMonth',
    labelKey: T.F.METRIC.CMP.TIME_FRAME_1_MONTH,
    limit: 30,
  },
  {
    id: 'max',
    labelKey: T.F.METRIC.CMP.TIME_FRAME_MAX,
    limit: null,
  },
];

@Component({
  selector: 'lazy-chart',
  templateUrl: './lazy-chart.component.html',
  styleUrls: ['./lazy-chart.component.scss'],
  standalone: true,
  imports: [
    MatIconButton,
    MatTooltip,
    MatIcon,
    TranslatePipe,
    MatRadioGroup,
    MatRadioButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LazyChartComponent implements OnDestroy {
  private readonly chartLoaderService = inject(ChartLazyLoaderService);
  private readonly shareService = inject(ShareService);
  private readonly snackService = inject(SnackService);

  readonly type = input.required<ChartType>();
  readonly datasets = input<ChartData['datasets']>([]);
  readonly labels = input<ChartData['labels'] | undefined>(undefined);
  readonly options = input<ChartOptions | undefined>(undefined);
  readonly legend = input(true);
  readonly height = input('400px');
  readonly shareFileName = input('chart.png');
  readonly enableTimeframeSelector = input(false);

  readonly chartClick = new EventEmitter<ChartClickEvent>();

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  readonly isModuleLoaded = signal(false);
  readonly isSharing = signal(false);
  readonly timeframeOptions = TIMEFRAME_OPTIONS;
  readonly T = T;

  readonly selectedTimeframe = signal<LazyChartTimeframe>('max');
  private readonly activeTimeframe = computed<LazyChartTimeframe>(() =>
    this.enableTimeframeSelector() ? this.selectedTimeframe() : 'max',
  );

  private readonly filteredChartData = computed<ChartData<ChartType>>(() =>
    this.buildFilteredChartData(this.labels(), this.datasets(), this.activeTimeframe()),
  );

  private readonly resolvedChartOptions = computed<ChartOptions>(() => {
    const baseOptions = this.options();
    const legendDisplay = this.legend();
    return {
      responsive: true,
      maintainAspectRatio: false,
      ...(baseOptions ?? {}),
      plugins: {
        ...baseOptions?.plugins,
        legend: {
          display: legendDisplay,
          ...baseOptions?.plugins?.legend,
        },
      },
    };
  });

  private readonly chartOptionsWithHandlers = computed<ChartOptions>(() =>
    this.buildChartOptions(this.resolvedChartOptions(), this.options()),
  );

  private chartInstance: ChartJS | null = null;

  private readonly chartUpdateEffect = effect(() => {
    const isLoaded = this.isModuleLoaded();
    const canvas = this.canvasRef();

    if (!isLoaded || !canvas) {
      return;
    }

    if (!this.chartInstance) {
      this.initChart(canvas);
      return;
    }

    const data = this.filteredChartData();
    const options = this.chartOptionsWithHandlers();
    this.applyChartUpdate(data, options);
  });

  private readonly selectorEnabledState = signal(false);
  private readonly timeframeEffect = effect(
    () => {
      const isEnabled = this.enableTimeframeSelector();
      const wasEnabled = this.selectorEnabledState();
      if (isEnabled && !wasEnabled && this.selectedTimeframe() === 'max') {
        this.selectedTimeframe.set('twoWeeks');
      } else if (!isEnabled && wasEnabled && this.selectedTimeframe() !== 'max') {
        this.selectedTimeframe.set('max');
      }
      this.selectorEnabledState.set(isEnabled);
    },
    { allowSignalWrites: true },
  );

  constructor() {
    void this.loadChartModule();
  }

  onTimeframeChange(timeframe: LazyChartTimeframe): void {
    if (this.selectedTimeframe() === timeframe) {
      return;
    }
    this.selectedTimeframe.set(timeframe);
  }

  onTimeframeRadioChange(event: MatRadioChange): void {
    const value = event.value as LazyChartTimeframe | null;
    if (!value) {
      event.source.value = this.selectedTimeframe();
      return;
    }
    this.onTimeframeChange(value);
  }

  async shareChart(): Promise<void> {
    if (!this.chartInstance?.canvas || this.isSharing()) {
      return;
    }

    this.isSharing.set(true);

    try {
      const shareFile = this.shareFileName();
      const result = await this.shareService.shareCanvasImage({
        canvas: this.chartInstance.canvas,
        filename: shareFile,
        shareTitle: shareFile,
        tagline: {
          text: 'With the Super Productivity App',
        },
      });

      if (result.success && result.target === 'download') {
        const message = result.path
          ? `Chart image saved to ${result.path}`
          : 'Chart image saved to device storage';
        const canOpen = this.shareService.canOpenDownloadResult(result);
        const actionConfig = canOpen
          ? {
              actionStr: T.GLOBAL_SNACK.FILE_DOWNLOADED_BTN,
              actionFn: () => {
                void this.shareService.openDownloadResult(result);
              },
            }
          : {};

        this.snackService.open({
          type: 'SUCCESS',
          msg: message,
          isSkipTranslate: true,
          ...actionConfig,
        });
      }

      if (!result.success && result.error && result.error !== 'Share cancelled') {
        console.error('Share failed:', result.error);
      }
    } catch (error) {
      console.error('Share failed:', error);
    } finally {
      this.isSharing.set(false);
    }
  }

  ngOnDestroy(): void {
    this.chartUpdateEffect.destroy();
    this.timeframeEffect.destroy();
    this.chartInstance?.destroy();
    this.chartInstance = null;
  }

  private async loadChartModule(): Promise<void> {
    try {
      await this.chartLoaderService.loadChartModule();
      this.isModuleLoaded.set(true);
    } catch (error) {
      console.error('Failed to load chart module:', error);
    }
  }

  private initChart(canvas: ElementRef<HTMLCanvasElement>): void {
    const chartModule = this.chartLoaderService.getChartModule();
    if (!chartModule) {
      console.error('Chart module not loaded');
      return;
    }

    const { Chart } = chartModule;
    const chartConfig: ChartConfiguration = {
      type: this.type(),
      data: this.filteredChartData(),
      options: this.chartOptionsWithHandlers(),
    };

    try {
      this.chartInstance?.destroy();
      this.chartInstance = new Chart(canvas.nativeElement, chartConfig);
    } catch (error) {
      console.error('Failed to initialize chart:', error);
    }
  }

  private applyChartUpdate(data: ChartData<ChartType>, options: ChartOptions): void {
    if (!this.chartInstance) {
      return;
    }

    this.chartInstance.data.labels = data.labels as typeof this.chartInstance.data.labels;
    this.chartInstance.data.datasets =
      data.datasets as typeof this.chartInstance.data.datasets;
    this.chartInstance.options = this.cloneChartOptions(options);
    this.chartInstance.update();
  }

  private buildFilteredChartData(
    labels: ChartData['labels'] | undefined,
    datasets: ChartData['datasets'],
    timeframe: LazyChartTimeframe,
  ): ChartData<ChartType> {
    const limit = this.getTimeframeLimit(timeframe);
    const isArrayOfLabels = Array.isArray(labels);
    const effectiveDatasets = datasets ?? [];

    if (!isArrayOfLabels || limit === null || labels.length <= limit) {
      const clonedLabels = isArrayOfLabels
        ? (labels.slice() as ChartData['labels'])
        : labels;
      return {
        labels: clonedLabels,
        datasets: this.cloneDatasets(effectiveDatasets),
      };
    }

    const sliceStart = Math.max(labels.length - limit, 0);
    return {
      labels: labels.slice(sliceStart) as ChartData['labels'],
      datasets: this.cloneDatasets(effectiveDatasets, sliceStart),
    };
  }

  private getTimeframeLimit(timeframe: LazyChartTimeframe): number | null {
    return this.timeframeOptions.find((option) => option.id === timeframe)?.limit ?? null;
  }

  private cloneDatasets(
    datasets: ChartData['datasets'],
    sliceStart = 0,
  ): ChartData['datasets'] {
    if (!Array.isArray(datasets)) {
      return datasets;
    }

    const typedDatasets = datasets as ChartDataset<
      ChartType,
      DefaultDataPoint<ChartType>
    >[];

    return typedDatasets.map((dataset) => {
      if (!Array.isArray(dataset.data)) {
        return { ...dataset };
      }

      const typedData = dataset.data as DefaultDataPoint<ChartType>[];
      const data = sliceStart > 0 ? typedData.slice(sliceStart) : typedData.slice();

      return {
        ...dataset,
        data,
      };
    }) as ChartData['datasets'];
  }

  private buildChartOptions(
    baseOptions: ChartOptions,
    originalOptions?: ChartOptions,
  ): ChartOptions {
    const basePlugins = baseOptions.plugins ?? {};
    const legend = basePlugins.legend ? { ...basePlugins.legend } : undefined;
    const plugins = { ...basePlugins, legend };
    const optionsClone: ChartOptions = {
      ...baseOptions,
      plugins,
      onClick: (event: ChartEvent, activeElements: ActiveElement[], chart?: ChartJS) => {
        this.chartClick.emit({ active: activeElements });
        const targetChart = chart ?? this.chartInstance;
        if (targetChart) {
          originalOptions?.onClick?.(event, activeElements, targetChart);
        }
      },
    };

    return optionsClone;
  }

  private cloneChartOptions(options: ChartOptions): ChartOptions {
    const plugins = options.plugins
      ? {
          ...options.plugins,
          legend: options.plugins.legend ? { ...options.plugins.legend } : undefined,
        }
      : undefined;
    return {
      ...options,
      plugins,
    };
  }
}
