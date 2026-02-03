import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { HabitTrackerComponent } from '../../features/simple-counter/habit-tracker/habit-tracker.component';
import { T } from '../../t.const';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'habit-page',
  standalone: true,
  imports: [CommonModule, HabitTrackerComponent, TranslateModule],
  template: `
    <div class="page-wrapper">
      <habit-tracker [simpleCounters]="(simpleCounters$ | async) || []"></habit-tracker>
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
  simpleCounterService = inject(SimpleCounterService);
  simpleCounters$ = this.simpleCounterService.enabledSimpleCounters$;
  T = T;
}
