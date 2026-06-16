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
  /** View to open on first render when nothing is persisted. */
  readonly initialView = input<HeatmapView>('year');
  /** Optional in-card nav for the YEAR view (e.g. ‹ 2026 ›); the month view has
   *  its own ‹ June 2026 › nav. Hidden while the label is empty. */
  readonly navLabel = input<string>('');
  readonly canNavPrev = input<boolean>(false);
  readonly canNavNext = input<boolean>(false);
  readonly navPrev = output<void>();
  readonly navNext = output<void>();
  readonly dayClick = output<DayData>();
  readonly dayDblClick = output<DayData>();
  /** Passed through to both views: makes day cells keyboard-reachable buttons
   *  for consumers that act on `dayClick` (e.g. click-to-simulate). */
  readonly interactive = input<boolean>(false);
  /** Passed through to the MONTH view: unlimited month navigation. The consumer
   *  listens to `monthViewChange` and moves its data window along. */
  readonly monthBoundless = input<boolean>(false);
  readonly monthViewChange = output<{ y: number; m: number }>();
  /** Passed through to both views — preview-only flourish (default off). */
  readonly showWeekends = input<boolean>(false);
  /** Passed through to both views — show the green activity legend swatch. */
  readonly showActivity = input<boolean>(false);
  /** Direct-manipulation mode — day clicks become contextual-menu requests, and
   *  (month view) weekday headers / month title become clickable + annotated. */
  readonly interactiveMenus = input<boolean>(false);
  /** Per-weekday header glyphs (Mon=0 … Sun=6), passed to the MONTH view. */
  readonly weekdayHeaderGlyphs = input<Map<
    number,
    { top?: string; mid?: string; bottom?: string }
  > | null>(null);
  /** Months (0=Jan … 11=Dec) limited via BYMONTH — shown with a chip in both views. */
  readonly limitedMonths = input<number[] | null>(null);
  /** Per-weekday (Mon=0 … Sun=6) hover tooltip text, passed to both views. */
  readonly weekdayHeaderTooltips = input<Map<number, string> | null>(null);
  /** Tooltip for a limited month label/title, passed to both views. */
  readonly monthTooltip = input<string>('');
  readonly dayMenu = output<{ data: DayData; event: MouseEvent }>();
  readonly weekdayHeaderMenu = output<{ weekdayIdx: number; event: MouseEvent }>();
  readonly monthLabelMenu = output<{ month: number; event: MouseEvent }>();
  /** A date (YYYY-MM-DD) to bring into view in the active sub-view — month view
   *  jumps to its month, year strip scrolls to its cell. */
  readonly focusDate = input<string | null>(null);

  readonly view = signal<HeatmapView>('year');

  private _restored = false;

  constructor() {
    // Inputs aren't available at construction time — apply the initial view once
    // they are: a persisted preference wins, otherwise the consumer's initialView.
    effect(() => {
      if (this._restored) {
        return;
      }
      this._restored = true;
      const key = this.persistKey();
      if (key) {
        try {
          const stored = localStorage.getItem(STORAGE_PREFIX + key);
          if (stored === 'year' || stored === 'month') {
            this.view.set(stored);
            return;
          }
        } catch (e) {
          Log.err('Failed to read heatmap view preference', e);
        }
      }
      this.view.set(this.initialView());
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
