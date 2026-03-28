import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { IssueService } from '../issue/issue.service';
import { IssueProviderPluginType, isPluginIssueProvider } from '../issue/issue.model';
import { selectIssueProviderById } from '../issue/store/issue-provider.selectors';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { HiddenCalendarEventsService } from './hidden-calendar-events.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ScheduleFromCalendarEvent } from '../schedule/schedule.model';
import { Log } from '../../core/log';

@Injectable({
  providedIn: 'root',
})
export class CalendarEventActionsService {
  private _store = inject(Store);
  private _issueService = inject(IssueService);
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private _hiddenEventsService = inject(HiddenCalendarEventsService);
  private _snackService = inject(SnackService);

  isPluginEvent(calEv: ScheduleFromCalendarEvent): boolean {
    return (
      !!calEv.issueProviderKey && isPluginIssueProvider(calEv.issueProviderKey as any)
    );
  }

  async openEventLink(calEv: ScheduleFromCalendarEvent): Promise<void> {
    if (!this.isPluginEvent(calEv)) {
      return;
    }
    const provider = this._pluginRegistry.getProvider(calEv.issueProviderKey!);
    if (!provider?.definition.getIssueLink) {
      return;
    }
    try {
      const cfg = (await firstValueFrom(
        this._store.select(
          selectIssueProviderById(calEv.calProviderId, calEv.issueProviderKey as any),
        ),
      )) as IssueProviderPluginType;
      const link = provider.definition.getIssueLink(calEv.id, cfg.pluginConfig);
      if (link) {
        window.open(link, '_blank');
      }
    } catch (e) {
      Log.warn('Failed to resolve issue provider config for calendar event', e);
    }
  }

  createAsTask(calEv: ScheduleFromCalendarEvent): void {
    this._issueService.addTaskFromIssue({
      issueDataReduced: calEv,
      issueProviderId: calEv.calProviderId,
      issueProviderKey: (calEv.issueProviderKey as any) || 'ICAL',
      isForceDefaultProject: true,
    });
  }

  hideForever(calEv: ScheduleFromCalendarEvent): void {
    this._hiddenEventsService.hideEvent(calEv);
    this._snackService.open({ type: 'SUCCESS', msg: T.F.CALENDARS.S.EVENT_HIDDEN });
  }
}
