import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostBinding,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { ScheduleFromCalendarEvent } from '../../schedule/schedule.model';
import { MatIcon } from '@angular/material/icon';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';

@Component({
  selector: 'planner-calendar-event',
  templateUrl: './planner-calendar-event.component.html',
  styleUrl: './planner-calendar-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MsToStringPipe, MatMenu, MatMenuItem, MatMenuTrigger, TranslatePipe],
})
export class PlannerCalendarEventComponent {
  T = T;
  private _calEventActions = inject(CalendarEventActionsService);

  readonly calendarEvent = input.required<ScheduleFromCalendarEvent>();
  isBeingSubmitted = false;

  @HostBinding('attr.title') title = '';

  @HostBinding('class.isBeingSubmitted')
  get isBeingSubmittedG(): boolean {
    return this.isBeingSubmitted;
  }

  readonly menuTrigger = viewChild.required(MatMenuTrigger);

  readonly isPluginEvent = computed(() =>
    this._calEventActions.isPluginEvent(this.calendarEvent()),
  );

  readonly hasEventUrl = computed(() =>
    this._calEventActions.hasEventUrl(this.calendarEvent()),
  );

  openMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.menuTrigger().openMenu();
  }

  async openEventLink(): Promise<void> {
    await this._calEventActions.openEventLink(this.calendarEvent());
  }

  createAsTask(): void {
    if (this.isBeingSubmitted) {
      return;
    }
    this.isBeingSubmitted = true;
    this._calEventActions.createAsTask(this.calendarEvent());
  }

  async reschedule(): Promise<void> {
    await this._calEventActions.reschedule(this.calendarEvent());
  }

  async deleteEvent(): Promise<void> {
    await this._calEventActions.deleteEvent(this.calendarEvent());
  }

  hide(): void {
    this._calEventActions.hideForever(this.calendarEvent());
  }
}
