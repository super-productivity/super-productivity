import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { DayData, HeatmapComponent, HeatmapViewData } from './heatmap.component';
import { HeatmapMonthCalendarComponent } from './heatmap-month-calendar.component';
import { Log } from '../../core/log';

type HeatmapView = 'year' | 'month';
const STORAGE_PREFIX = 'sp_heatmap_view_';

/**
 * Wraps the year strip (HeatmapComponent, month-grouped) and the single-month
 * calendar (HeatmapMonthCalendarComponent) behind a Year/Month toggle. Consumers
 * supply both the pre-built year `data` and the raw `dayMap` + range the month
 * view navigates. With a `persistKey`, the chosen view is remembered per
 * consumer in localStorage (a per-device UI preference — not synced).
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
  readonly data = input.required<HeatmapViewData | null>();
  readonly dayMap = input.required<Map<string, DayData>>();
  readonly rangeStart = input.required<Date>();
  readonly rangeEnd = input.required<Date>();
  readonly legendMode = input<'intensity' | 'projection' | 'none'>('intensity');
  /** Storage slot for remembering the chosen view (empty → not persisted). */
  readonly persistKey = input<string>('');
  /** Optional in-card nav for the YEAR view (e.g. ‹ 2026 ›); the month view has
   *  its own ‹ June 2026 › nav. Hidden while the label is empty. */
  readonly navLabel = input<string>('');
  readonly canNavPrev = input<boolean>(false);
  readonly canNavNext = input<boolean>(false);
  readonly navPrev = output<void>();
  readonly navNext = output<void>();
  readonly dayClick = output<DayData>();
  /** Passed through to both views: makes day cells keyboard-reachable buttons
   *  for consumers that act on `dayClick` (e.g. click-to-simulate). */
  readonly interactive = input<boolean>(false);
  /** Passed through to the MONTH view: unlimited month navigation. The consumer
   *  listens to `monthViewChange` and moves its data window along. */
  readonly monthBoundless = input<boolean>(false);
  readonly monthViewChange = output<{ y: number; m: number }>();

  readonly view = signal<HeatmapView>('year');

  private _restored = false;

  constructor() {
    // Inputs aren't available at construction time — restore once they are.
    effect(() => {
      const key = this.persistKey();
      if (!key || this._restored) {
        return;
      }
      this._restored = true;
      try {
        const stored = localStorage.getItem(STORAGE_PREFIX + key);
        if (stored === 'year' || stored === 'month') {
          this.view.set(stored);
        }
      } catch (e) {
        Log.err('Failed to read heatmap view preference', e);
      }
    });
  }

  setView(view: HeatmapView): void {
    this.view.set(view);
    const key = this.persistKey();
    if (!key) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_PREFIX + key, view);
    } catch (e) {
      Log.err('Failed to persist heatmap view preference', e);
    }
  }
}
