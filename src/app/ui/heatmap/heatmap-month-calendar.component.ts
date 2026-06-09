import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DateAdapter } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { DayData } from './heatmap.component';
import { getDbDateStr } from '../../util/get-db-date-str';
import { msToString } from '../duration/ms-to-string.pipe';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';

interface CalCell {
  dateStr: string;
  dayNum: number;
  data: DayData | null;
  isOtherMonth: boolean;
}

/**
 * Single-month calendar view of a heatmap `dayMap`: numbered, level-coloured day
 * cells with prev/next month navigation, bounded to `[rangeStart, rangeEnd]`. A
 * companion to the year strip (see HeatmapComponent); the switcher toggles
 * between them.
 */
@Component({
  selector: 'heatmap-month-calendar',
  templateUrl: './heatmap-month-calendar.component.html',
  styleUrls: ['./heatmap-month-calendar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatIcon, MatIconButton, TranslatePipe],
})
export class HeatmapMonthCalendarComponent {
  readonly T = T;
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _translateService = inject(TranslateService);

  readonly dayMap = input.required<Map<string, DayData>>();
  readonly rangeStart = input.required<Date>();
  readonly rangeEnd = input.required<Date>();
  /** Which legend to show beneath the grid. */
  readonly legendMode = input<'hours' | 'occurrences' | 'none'>('hours');
  readonly dayClick = output<DayData>();

  // Explicit user navigation; null → the computed default month.
  private readonly _viewMonth = signal<{ y: number; m: number } | null>(null);
  readonly viewMonth = computed(() => this._viewMonth() ?? this._defaultMonth());

  readonly monthLabel = computed(() => {
    const { y, m } = this.viewMonth();
    return `${(this._dateAdapter.getMonthNames('long') as string[])[m]} ${y}`;
  });

  readonly weekdayLabels = computed(() => {
    const names = this._dateAdapter.getDayOfWeekNames('short') as string[];
    const first = this._dateAdapter.getFirstDayOfWeek();
    return [...names.slice(first), ...names.slice(0, first)];
  });

  readonly weeks = computed<CalCell[][]>(() => {
    const { y, m } = this.viewMonth();
    const firstDow = this._dateAdapter.getFirstDayOfWeek();
    const lead = (new Date(y, m, 1).getDay() - firstDow + 7) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const rows = Math.ceil((lead + daysInMonth) / 7);
    const map = this.dayMap();
    const grid: CalCell[][] = [];
    const cur = new Date(y, m, 1 - lead);
    for (let r = 0; r < rows; r++) {
      const row: CalCell[] = [];
      for (let c = 0; c < 7; c++) {
        const dateStr = getDbDateStr(cur);
        row.push({
          dateStr,
          dayNum: cur.getDate(),
          data: map.get(dateStr) ?? null,
          isOtherMonth: cur.getMonth() !== m,
        });
        cur.setDate(cur.getDate() + 1);
      }
      grid.push(row);
    }
    return grid;
  });

  readonly canPrev = computed(() => {
    const { y, m } = this.viewMonth();
    return new Date(y, m, 0) >= this._dayStart(this.rangeStart());
  });
  readonly canNext = computed(() => {
    const { y, m } = this.viewMonth();
    return new Date(y, m + 1, 1) <= this.rangeEnd();
  });

  prev(): void {
    if (!this.canPrev()) return;
    const { y, m } = this.viewMonth();
    this._viewMonth.set(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 });
  }
  next(): void {
    if (!this.canNext()) return;
    const { y, m } = this.viewMonth();
    this._viewMonth.set(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 });
  }

  onCellClick(cell: CalCell): void {
    if (cell.data) this.dayClick.emit(cell.data);
  }

  getCellClass(cell: CalCell): string {
    if (cell.isOtherMonth) return 'cal-day other-month';
    const d = cell.data;
    if (!d) return 'cal-day';
    return `cal-day level-${d.level}${d.isProjected ? ' projected' : ''}${
      d.isCompleted ? ' completed' : ''
    }`;
  }

  getCellTitle(cell: CalCell): string {
    const d = cell.data;
    if (!d || cell.isOtherMonth) return cell.dateStr;
    if (d.isCompleted) {
      return `${d.dateStr}: ${this._translateService.instant(T.G.HEATMAP_COMPLETED_SIM)}`;
    }
    if (d.isProjected) {
      return `${d.dateStr}: ${this._translateService.instant(T.G.HEATMAP_PROJECTED)}`;
    }
    return `${d.dateStr}: ${this._translateService.instant(T.G.HEATMAP_ACTIVITY, {
      count: d.taskCount,
      time: msToString(d.timeSpent),
    })}`;
  }

  private _defaultMonth(): { y: number; m: number } {
    const today = new Date();
    const inRange = today >= this.rangeStart() && today <= this.rangeEnd();
    const ref = inRange ? today : this.rangeEnd();
    return { y: ref.getFullYear(), m: ref.getMonth() };
  }
  private _dayStart(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}
