import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { PlannerTaskComponent } from '../../features/planner/planner-task/planner-task.component';
import { LocaleDatePipe } from '../../ui/pipes/locale-date.pipe';
import { parseDbDateStr } from '../../util/parse-db-date-str';
import { selectWeekDays } from './week-page.selectors';

@Component({
  selector: 'week-page',
  standalone: true,
  imports: [PlannerTaskComponent, LocaleDatePipe],
  templateUrl: './week-page.component.html',
  styleUrl: './week-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeekPageComponent {
  readonly weekDays = toSignal(inject(Store).select(selectWeekDays), {
    initialValue: [],
  });
  readonly dateForLabel = parseDbDateStr;
  readonly locale = inject(DateTimeFormatService).textLocale;
}
