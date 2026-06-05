import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';

/**
 * Per-day habits / simple counters shown when a History day is expanded.
 * Shared by both the quick and full History views so the counter markup
 * lives in one place.
 */
@Component({
  selector: 'history-day-meta',
  templateUrl: './history-day-meta.component.html',
  styleUrls: ['./history-day-meta.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatTooltip, MsToMinuteClockStringPipe],
})
export class HistoryDayMetaComponent {
  readonly counters = input.required<SimpleCounter[]>();
  readonly dateStr = input.required<string>();

  countForDay(sc: SimpleCounter, dateStr: string): number {
    return sc.countOnDay?.[dateStr] || 0;
  }
}
