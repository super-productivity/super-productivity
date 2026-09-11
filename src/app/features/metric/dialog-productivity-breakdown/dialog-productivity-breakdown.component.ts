import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule, DecimalPipe } from '@angular/common';
import { AsyncPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MetricService, ProductivityBreakdownItem } from '../metric.service';
import { LazyChartComponent } from '../lazy-chart/lazy-chart.component';
import { ChartConfiguration, ChartType, ChartData } from 'chart.js';
import { calculateSustainabilityScore } from '../metric-scoring.util';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';

interface DialogProductivityBreakdownData {
  days: number;
  endDate?: string;
  focus?: 'productivity' | 'sustainability';
}

@Component({
  selector: 'dialog-productivity-breakdown',
  standalone: true,
  templateUrl: './dialog-productivity-breakdown.component.html',
  styleUrls: ['./dialog-productivity-breakdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    AsyncPipe,
    DecimalPipe,
    LazyChartComponent,
    TranslatePipe,
  ],
})
export class DialogProductivityBreakdownComponent {
  private _metricService = inject(MetricService);
  private _dialogRef =
    inject<MatDialogRef<DialogProductivityBreakdownComponent>>(MatDialogRef);
  private _data = inject<DialogProductivityBreakdownData>(MAT_DIALOG_DATA);
  readonly T = T;
  readonly focus = this._data.focus ?? 'productivity';
  readonly titleKey =
    this.focus === 'sustainability'
      ? T.F.METRIC.EVAL_FORM.SCORE_BREAKDOWN_TITLE_SUSTAINABILITY
      : T.F.METRIC.EVAL_FORM.SCORE_BREAKDOWN_TITLE_PRODUCTIVITY;

  breakdown$: Observable<ProductivityBreakdownItem[]> =
    this._metricService.getProductivityBreakdown$(this._data.days, this._data.endDate);

  chartData$: Observable<ChartData> = this.breakdown$.pipe(
    map((breakdown) => {
      const labels = breakdown.map((item) => item.day);
      const productivityScores = breakdown.map((item) => item.score);
      const sustainabilityScores = breakdown.map((item) => {
        // Calculate sustainability score if we have energy data
        if (item.energyCheckin) {
          return this._calculateSustainabilityScore(
            item.focusedMinutes,
            item.totalWorkMinutes,
            item.energyCheckin,
          );
        }
        return null;
      });

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
      };
    }),
  );

  lineChartType: ChartType = 'line';
  lineChartOptions: ChartConfiguration<'line', (number | null)[], string>['options'] = {
    responsive: true,
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: {
          precision: 0,
        },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
      },
    },
  };

  private _calculateSustainabilityScore(
    focusedMinutes: number,
    totalWorkMinutes: number,
    energyCheckin: number,
  ): number {
    return calculateSustainabilityScore(focusedMinutes, totalWorkMinutes, energyCheckin);
  }

  close(): void {
    this._dialogRef.close();
  }
}
