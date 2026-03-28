import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { ScheduleFromCalendarEvent } from '../../schedule/schedule.model';
import { IssueService } from '../../issue/issue.service';
import { MatIcon } from '@angular/material/icon';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { HiddenCalendarEventsService } from '../../calendar-integration/hidden-calendar-events.service';
import { SnackService } from '../../../core/snack/snack.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { isPluginIssueProvider } from '../../issue/issue.model';

@Component({
  selector: 'planner-calendar-event',
  templateUrl: './planner-calendar-event.component.html',
  styleUrl: './planner-calendar-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MsToStringPipe, MatMenu, MatMenuItem, MatMenuTrigger, TranslatePipe],
})
export class PlannerCalendarEventComponent {
  T = T;
  private _issueService = inject(IssueService);
  private _hiddenEventsService = inject(HiddenCalendarEventsService);
  private _snackService = inject(SnackService);
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);

  readonly calendarEvent = input.required<ScheduleFromCalendarEvent>();
  isBeingSubmitted = false;

  @HostBinding('attr.title') title = '';

  @HostBinding('class.isBeingSubmitted')
  get isBeingSubmittedG(): boolean {
    return this.isBeingSubmitted;
  }

  readonly menuTrigger = viewChild.required(MatMenuTrigger);

  openMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.menuTrigger().openMenu();
  }

  openEventLink(): void {
    const calEv = this.calendarEvent();
    if (calEv.issueProviderKey && isPluginIssueProvider(calEv.issueProviderKey as any)) {
      const provider = this._pluginRegistry.getProvider(calEv.issueProviderKey);
      if (provider?.definition.getIssueLink) {
        const link = provider.definition.getIssueLink(calEv.id, {});
        if (link) {
          window.open(link, '_blank');
        }
      }
    }
  }

  createAsTask(): void {
    if (this.isBeingSubmitted) {
      return;
    }
    this.isBeingSubmitted = true;
    const calEv = this.calendarEvent();
    this._issueService.addTaskFromIssue({
      issueDataReduced: calEv,
      issueProviderId: calEv.calProviderId,
      issueProviderKey: (calEv.issueProviderKey as any) || 'ICAL',
      isForceDefaultProject: true,
    });
  }

  hideForever(): void {
    this._hiddenEventsService.hideEvent(this.calendarEvent());
    this._snackService.open({ type: 'SUCCESS', msg: T.F.CALENDARS.S.EVENT_HIDDEN });
  }
}
