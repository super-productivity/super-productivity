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
import { IssueSyncAdapterResolverService } from '../issue/two-way-sync/issue-sync-adapter-resolver.service';
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
import { getDbDateStr } from '../../util/get-db-date-str';

interface CalendarEventPushOptions {
  logMessage: string;
  undoChanges?: Record<string, unknown>;
  successMsg?: string;
}

@Injectable({
  providedIn: 'root',
})
export class CalendarEventActionsService {
  private _store = inject(Store);
  private _issueService = inject(IssueService);
  private _matDialog = inject(MatDialog);
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private _syncAdapterResolver = inject(IssueSyncAdapterResolverService);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _hiddenEventsService = inject(HiddenCalendarEventsService);
  private _snackService = inject(SnackService);

  isPluginEvent(calEv: ScheduleFromCalendarEvent): boolean {
    return isPluginIssueProvider(calEv.issueProviderKey as IssueProviderKey);
  }

  canMoveEvent(calEv: ScheduleFromCalendarEvent): boolean {
    if (calEv.isReferenceCalendar || !this.isPluginEvent(calEv)) {
      return false;
    }
    const provider = this._pluginRegistry.getProvider(calEv.issueProviderKey);
    return !!provider?.definition.updateIssue;
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
    const adapter = this._syncAdapterResolver.getAdapter(
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
      Log.err('Failed to delete calendar event', this._sanitizeLogError(e));
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.CALENDARS.S.CAL_PROVIDER_ERROR,
        translateParams: { errTxt: this._getSafeErrorTxt(e) },
      });
    }
  }

  async reschedule(calEv: ScheduleFromCalendarEvent): Promise<void> {
    if (!this.canMoveEvent(calEv)) {
      return;
    }
    const eventDate = new Date(calEv.start);
    const targetDay = getDbDateStr(eventDate);
    const targetTime = calEv.isAllDay
      ? undefined
      : `${String(eventDate.getHours()).padStart(2, '0')}:${String(eventDate.getMinutes()).padStart(2, '0')}`;

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
      changes = {
        start_date: getDbDateStr(result.date),
      };
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    await this._pushChanges(calEv, changes, {
      logMessage: 'Failed to reschedule calendar event',
      undoChanges: this._getCurrentScheduleChanges(calEv),
    });
  }

  async moveToStartTime(
    calEv: ScheduleFromCalendarEvent,
    newStartMs: number,
  ): Promise<boolean> {
    if (!this.canMoveEvent(calEv)) {
      return false;
    }

    /* eslint-disable @typescript-eslint/naming-convention */
    const changes = {
      start_dateTime: new Date(newStartMs).toISOString(),
      duration_ms: calEv.duration,
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    return this._pushChanges(calEv, changes, {
      logMessage: 'Failed to move calendar event',
      undoChanges: this._getCurrentScheduleChanges(calEv),
      successMsg: T.F.CALENDARS.S.EVENT_MOVED,
    });
  }

  private async _pushChanges(
    calEv: ScheduleFromCalendarEvent,
    changes: Record<string, unknown>,
    options: CalendarEventPushOptions,
  ): Promise<boolean> {
    const adapter = this._syncAdapterResolver.getAdapter(
      calEv.issueProviderKey as IssueProviderKey,
    );
    if (!adapter) {
      return false;
    }

    try {
      const cfg = await this._getPluginConfig(calEv);
      await adapter.pushChanges(calEv.id, changes, cfg);
      this._calendarIntegrationService.triggerRefresh();
      this._snackService.open({
        type: 'SUCCESS',
        msg: options.successMsg ?? T.F.CALENDARS.S.EVENT_RESCHEDULED,
        ...(options.undoChanges
          ? {
              actionStr: T.G.UNDO,
              actionFn: () =>
                this._pushChanges(calEv, options.undoChanges!, {
                  logMessage: 'Failed to undo calendar event reschedule',
                }),
            }
          : {}),
      });
      return true;
    } catch (e) {
      Log.err(options.logMessage, this._sanitizeLogError(e));
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.CALENDARS.S.CAL_PROVIDER_ERROR,
        translateParams: { errTxt: this._getSafeErrorTxt(e) },
      });
      return false;
    }
  }

  private _getCurrentScheduleChanges(
    calEv: ScheduleFromCalendarEvent,
  ): Record<string, unknown> {
    /* eslint-disable @typescript-eslint/naming-convention */
    return calEv.isAllDay
      ? { start_date: getDbDateStr(calEv.start) }
      : {
          start_dateTime: new Date(calEv.start).toISOString(),
          duration_ms: calEv.duration,
        };
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  private _sanitizeLogError(e: unknown): Record<string, unknown> {
    const err = e as {
      name?: unknown;
      status?: unknown;
      statusText?: unknown;
    };
    return {
      ...(typeof err?.name === 'string' ? { name: err.name } : {}),
      ...(typeof err?.status === 'number' ? { status: err.status } : {}),
      ...(typeof err?.statusText === 'string' ? { statusText: err.statusText } : {}),
    };
  }

  private _getSafeErrorTxt(e: unknown): string {
    const err = this._sanitizeLogError(e);
    if (typeof err.status === 'number' && typeof err.statusText === 'string') {
      return `${err.status} ${err.statusText}`;
    }
    if (typeof err.status === 'number') {
      return String(err.status);
    }
    return typeof err.name === 'string' ? err.name : T.F.CALENDARS.S.CAL_PROVIDER_ERROR;
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
