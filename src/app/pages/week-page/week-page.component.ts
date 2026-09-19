import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { PlannerDayComponent } from '../../features/planner/planner-day/planner-day.component';
import { PlannerService } from '../../features/planner/planner.service';

/** Today plus the next six logical days. */
const WEEK_DAY_COUNT = 7;

@Component({
  selector: 'week-page',
  imports: [PlannerDayComponent, CdkDropListGroup, CdkScrollable],
  templateUrl: './week-page.component.html',
  styleUrl: './week-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeekPageComponent {
  readonly days = toSignal(inject(PlannerService).daysFor$(WEEK_DAY_COUNT), {
    initialValue: [],
  });
}
