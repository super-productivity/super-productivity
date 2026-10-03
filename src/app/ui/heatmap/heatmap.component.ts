import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DateAdapter } from '@angular/material/core';
import { TranslatePipe, TranslateService, TranslateStore } from '@ngx-translate/core';
import { T } from '../../t.const';
import { getPluralKey } from '../../util/get-plural-key';
import { msToString } from '../duration/ms-to-string.pipe';

export interface DayData {
  date: Date;
  dateStr: string;
  taskCount: number;
  timeSpent: number;
  level: number; // 0-4 for color intensity
}

export interface WeekData {
  days: (DayData | null)[];
}

export interface HeatmapData {
  weeks: WeekData[];
  monthLabels: string[];
}

@Component({
  selector: 'heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [TranslatePipe],
})
export class HeatmapComponent {
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _translateService = inject(TranslateService);
  private readonly _translateStore = inject(TranslateStore);

  readonly T = T;

  readonly data = input.required<HeatmapData | null>();
  readonly label = input<string>('');
  readonly showLegend = input<boolean>(true);
  readonly scrollToEnd = input<boolean>(false);

  private readonly _scrollableContent =
    viewChild<ElementRef<HTMLElement>>('scrollableContent');

  constructor() {
    effect(() => {
      const data = this.data();
      const scrollEl = this._scrollableContent()?.nativeElement;
      if (data && scrollEl && this.scrollToEnd()) {
        // Use setTimeout to ensure DOM is updated
        setTimeout(() => {
          scrollEl.scrollTo({ left: scrollEl.scrollWidth, behavior: 'instant' });
        });
      }
    });
  }

  /** Emits whenever the date locale changes so locale-derived labels re-compute. */
  private readonly _localeChange = toSignal(this._dateAdapter.localeChanges, {
    initialValue: null,
  });

  /** Emits whenever the UI language changes so translated labels re-compute. */
  private readonly _langChange = toSignal(this._translateService.onLangChange, {
    initialValue: null,
  });

  readonly dayLabels = computed(() => {
    this._localeChange();
    const allDays = this._dateAdapter.getDayOfWeekNames('short');
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    return [...allDays.slice(firstDay), ...allDays.slice(0, firstDay)];
  });

  /**
   * Day tooltips keyed by `dateStr`. Pre-computed rather than resolved per cell so
   * a full year of days costs one translation pass instead of ~365 per render.
   */
  private readonly _dayTitles = computed(() => {
    this._langChange();
    const titles = new Map<string, string>();
    for (const week of this.data()?.weeks ?? []) {
      for (const day of week.days) {
        if (day) {
          titles.set(day.dateStr, this._buildDayTitle(day));
        }
      }
    }
    return titles;
  });

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
    return this._dayTitles().get(day.dateStr) ?? '';
  }

  private _buildDayTitle(day: DayData): string {
    const key = getPluralKey(
      this._translateService,
      this._translateStore,
      day.taskCount,
      'HEATMAP.DAY_TOOLTIP',
    );
    return this._translateService.instant(key, {
      date: day.dateStr,
      taskCount: day.taskCount,
      timeSpent: msToString(day.timeSpent),
    });
  }
}
