import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { DayData, HeatmapComponent, HeatmapData } from './heatmap.component';
import { HeatmapMonthCalendarComponent } from './heatmap-month-calendar.component';

/**
 * Wraps the year strip (HeatmapComponent, month-grouped) and the single-month
 * calendar (HeatmapMonthCalendarComponent) behind a Year/Month toggle. Consumers
 * supply both the pre-built year `data` and the raw `dayMap` + range the month
 * view navigates.
 */
@Component({
  selector: 'heatmap-switcher',
  templateUrl: './heatmap-switcher.component.html',
  styleUrls: ['./heatmap-switcher.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    HeatmapComponent,
    HeatmapMonthCalendarComponent,
    MatButtonToggleModule,
    TranslatePipe,
  ],
})
export class HeatmapSwitcherComponent {
  readonly T = T;
  readonly data = input.required<HeatmapData | null>();
  readonly dayMap = input.required<Map<string, DayData>>();
  readonly rangeStart = input.required<Date>();
  readonly rangeEnd = input.required<Date>();
  readonly legendMode = input<'hours' | 'occurrences' | 'none'>('hours');
  readonly dayClick = output<DayData>();

  readonly view = signal<'year' | 'month'>('year');
}
