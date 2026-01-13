import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  HostListener,
  inject,
  input,
} from '@angular/core';
import { ScheduleFromCalendarEvent } from '../../schedule/schedule.model';
import { IssueService } from '../../issue/issue.service';
import { MatIcon } from '@angular/material/icon';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';

@Component({
  selector: 'planner-calendar-event',
  templateUrl: './planner-calendar-event.component.html',
  styleUrl: './planner-calendar-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MsToStringPipe],
})
export class PlannerCalendarEventComponent {
  private _issueService = inject(IssueService);

  readonly calendarEvent = input.required<ScheduleFromCalendarEvent>();
  isBeingSubmitted = false;

  @HostBinding('attr.title') title = `Convert to task`;

  @HostBinding('class.isBeingSubmitted')
  get isBeingSubmittedG(): boolean {
    return this.isBeingSubmitted;
  }

  @HostListener('click')
  async onClick(): Promise<void> {
    if (this.isBeingSubmitted) {
      return;
    }

    this.isBeingSubmitted = true;
    this._issueService.addTaskFromIssue({
      issueDataReduced: this.calendarEvent(),
      issueProviderId: this.calendarEvent().calProviderId,
      issueProviderKey: 'ICAL',
      isForceDefaultProject: true,
    });
  }
}
