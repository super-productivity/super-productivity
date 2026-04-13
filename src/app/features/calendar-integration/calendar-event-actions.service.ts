import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { IssueService } from '../issue/issue.service';
import {
  IssueProviderKey,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../issue/issue.model';
import { selectIssueProviderById } from '../issue/store/issue-provider.selectors';
import { IssueSyncAdapterRegistryService } from '../issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { HiddenCalendarEventsService } from './hidden-calendar-events.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ScheduleFromCalendarEvent } from '../schedule/schedule.model';
import { Log } from '../../core/log';
import { IS_ELECTRON } from '../../app.constants';
import { DialogScheduleTaskComponent } from '../planner/dialog-schedule-task/dialog-schedule-task.component';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { getDateTimeFromClockString } from '../../util/get-date-time-from-clock-string';
import { getErrorTxt } from '../../util/get-error-text';

@Injectable({
  providedIn: 'root',
})
export class CalendarEventActionsService {
  private _store = inject(Store);
  private _issueService = inject(IssueService);
  private _matDialog = inject(MatDialog);
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private _syncAdapterRegistry = inject(IssueSyncAdapterRegistryService);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _hiddenEventsService = inject(HiddenCalendarEventsService);
  private _snackService = inject(SnackService);

  isPluginEvent(calEv: ScheduleFromCalendarEvent): boolean {
    return isPluginIssueProvider(calEv.issueProviderKey as IssueProviderKey);
  }

  hasEventUrl(calEv: ScheduleFromCalendarEvent): boolean {
    return this.isPluginEvent(calEv) || !!calEv.url;
  }

  async openEventLink(calEv: ScheduleFromCalendarEvent): Promise<void> {
    // For iCal events with a URL property, open directly
    if (!this.isPluginEvent(calEv)) {
      if (calEv.url) {
        this._openUrl(calEv.url);
      }
      return;
    }
    // For plugin events, resolve the link via the plugin registry
    const provider = this._pluginRegistry.getProvider(calEv.issueProviderKey);
    if (!provider?.definition.getIssueLink) {
      return;
    }
    try {
      const cfg = await this._getPluginConfig(calEv);
      const link = provider.definition.getIssueLink(calEv.id, cfg.pluginConfig);
      if (link) {
        this._openUrl(link);
      }
    } catch (e) {
      Log.warn('Failed to resolve issue provider config for calendar event', e);
    }
  }

  createAsTask(calEv: ScheduleFromCalendarEvent): void {
    this._issueService.addTaskFromIssue({
      issueDataReduced: calEv,
      issueProviderId: calEv.calProviderId,
      issueProviderKey: calEv.issueProviderKey as IssueProviderKey,
      isForceDefaultProject: true,
    });
  }

  hideForever(calEv: ScheduleFromCalendarEvent): void {
    this._hiddenEventsService.hideEvent(calEv);
    this._snackService.open({ type: 'SUCCESS', msg: T.F.CALENDARS.S.EVENT_HIDDEN });
  }

  async deleteEvent(calEv: ScheduleFromCalendarEvent): Promise<void> {
    if (!this.isPluginEvent(calEv)) {
      return;
    }
    const dialogRef = this._matDialog.open(DialogConfirmComponent, {
      restoreFocus: true,
      data: {
        cancelTxt: T.G.CANCEL,
        okTxt: T.G.DELETE,
        message: T.F.CALENDARS.CONTEXT_MENU.DELETE_EVENT,
      },
    });
    const isConfirm = await firstValueFrom(dialogRef.afterClosed());
    if (!isConfirm) {
      return;
    }
    const adapter = this._syncAdapterRegistry.get(
      calEv.issueProviderKey as IssueProviderKey,
    );
    if (!adapter?.deleteIssue) {
      return;
    }
    try {
      const cfg = await this._getPluginConfig(calEv);
      await adapter.deleteIssue(calEv.id, cfg);
      this._calendarIntegrationService.triggerRefresh();
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.CALENDARS.S.EVENT_DELETED,
      });
    } catch (e) {
      Log.err('Failed to delete calendar event', e);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.CALENDARS.S.CAL_PROVIDER_ERROR,
        translateParams: { errTxt: getErrorTxt(e) },
      });
    }
  }

  async reschedule(calEv: ScheduleFromCalendarEvent): Promise<void> {
    if (!this.isPluginEvent(calEv)) {
      return;
    }
    const eventDate = new Date(calEv.start);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const targetDay = `${eventDate.getFullYear()}-${pad(eventDate.getMonth() + 1)}-${pad(eventDate.getDate())}`;
    const targetTime = calEv.isAllDay
      ? undefined
      : `${pad(eventDate.getHours())}:${pad(eventDate.getMinutes())}`;

    const dialogRef = this._matDialog.open(DialogScheduleTaskComponent, {
      restoreFocus: true,
      data: { targetDay, targetTime, isSelectDueOnly: true },
    });
    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result || typeof result !== 'object' || !result.date) {
      return;
    }

    /* eslint-disable @typescript-eslint/naming-convention */
    // Build changes based on whether it's a timed or all-day reschedule
    let changes: Record<string, unknown>;
    if (result.time) {
      const newStartMs = getDateTimeFromClockString(result.time, result.date);
      // For all-day events being rescheduled to a specific time, use a 1-hour default
      // instead of the 24-hour all-day duration
      const durationMs =
        calEv.isAllDay || calEv.duration >= 24 * 60 * 60 * 1000
          ? 60 * 60 * 1000
          : calEv.duration;
      changes = {
        start_dateTime: new Date(newStartMs).toISOString(),
        duration_ms: durationMs,
      };
    } else {
      // Parse as local midnight to avoid UTC date shift in western timezones
      const d = new Date(result.date + 'T00:00:00');
      changes = {
        start_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      };
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    const adapter = this._syncAdapterRegistry.get(
      calEv.issueProviderKey as IssueProviderKey,
    );
    if (!adapter) {
      return;
    }
    try {
      const cfg = await this._getPluginConfig(calEv);
      await adapter.pushChanges(calEv.id, changes, cfg);
      this._calendarIntegrationService.triggerRefresh();
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.CALENDARS.S.EVENT_RESCHEDULED,
      });
    } catch (e) {
      Log.err('Failed to reschedule calendar event', e);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.CALENDARS.S.CAL_PROVIDER_ERROR,
        translateParams: { errTxt: getErrorTxt(e) },
      });
    }
  }

  private async _getPluginConfig(
    calEv: ScheduleFromCalendarEvent,
  ): Promise<IssueProviderPluginType> {
    return (await firstValueFrom(
      this._store.select(
        selectIssueProviderById(
          calEv.calProviderId,
          calEv.issueProviderKey as IssueProviderKey,
        ),
      ),
    )) as IssueProviderPluginType;
  }

  private _openUrl(url: string): void {
    if (!/^https?:\/\//i.test(url)) {
      return;
    }
    if (IS_ELECTRON) {
      window.ea.openExternalUrl(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}
