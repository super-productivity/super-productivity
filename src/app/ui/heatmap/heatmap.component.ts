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
import { DateAdapter } from '@angular/material/core';

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
  imports: [],
})
export class HeatmapComponent {
  private readonly _dateAdapter = inject(DateAdapter);

  readonly data = input.required<HeatmapData | null>();
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

  readonly dayLabels = computed(() => {
    const allDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    return [...allDays.slice(firstDay), ...allDays.slice(0, firstDay)];
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
}
