import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostBinding,
  inject,
  input,
} from '@angular/core';
import { ScheduleFromCalendarEvent } from '../../schedule/schedule.model';
import { MatIcon } from '@angular/material/icon';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { CalendarIntegrationService } from '../../calendar-integration/calendar-integration.service';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { IS_ELECTRON } from '../../../app.constants';

@Component({
  selector: 'planner-calendar-event',
  templateUrl: './planner-calendar-event.component.html',
  styleUrl: './planner-calendar-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MsToStringPipe, MatMenu, MatMenuItem, MatMenuTrigger, TranslatePipe],
})
export class PlannerCalendarEventComponent {
  readonly T: typeof T = T;
  private _calEventActions = inject(CalendarEventActionsService);
  private _calendarIntegrationService = inject(CalendarIntegrationService);

  readonly calendarEvent = input.required<ScheduleFromCalendarEvent>();
  isBeingSubmitted = false;

  @HostBinding('class.isBeingSubmitted')
  get isBeingSubmittedG(): boolean {
    return this.isBeingSubmitted;
  }

  readonly isPluginEvent = computed(() =>
    this._calEventActions.isPluginEvent(this.calendarEvent()),
  );

  openInBrowser(): void {
    const url = this.calendarEvent().url;
    if (url) {
      if (IS_ELECTRON) {
        window.ea.openExternalUrl(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  }

  async openEventLink(): Promise<void> {
    await this._calEventActions.openEventLink(this.calendarEvent());
  }

  addAsTask(): void {
    if (this.isBeingSubmitted) {
      return;
    }
    this.isBeingSubmitted = true;
    this._calEventActions.createAsTask(this.calendarEvent());
  }

  hide(): void {
    this._calendarIntegrationService.skipCalendarEvent(this.calendarEvent());
  }

  hideForever(): void {
    this._calEventActions.hideForever(this.calendarEvent());
  }
}
