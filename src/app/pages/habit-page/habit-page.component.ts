import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { HabitTrackerComponent } from '../../features/simple-counter/habit-tracker/habit-tracker.component';
import { map } from 'rxjs/operators';

@Component({
  selector: 'habit-page',
  standalone: true,
  imports: [CommonModule, HabitTrackerComponent],
  template: `
    <div class="page-wrapper">
      <habit-tracker
        [simpleCounters]="(simpleCounters$ | async) || []"
        [disabledSimpleCounters]="(disabledSimpleCounters$ | async) || []"
      ></habit-tracker>
    </div>
  `,
  styles: [
    `
      .page-wrapper {
        padding: 16px;
        max-width: 1000px;
        margin: 0 auto;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HabitPageComponent {
  private _simpleCounterService = inject(SimpleCounterService);
  simpleCounters$ = this._simpleCounterService.enabledSimpleCounters$;
  disabledSimpleCounters$ = this._simpleCounterService.simpleCounters$.pipe(
    map((counters) => counters.filter((c) => !c.isEnabled)),
  );
}
