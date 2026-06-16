import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { CalendarEventActionsService } from './calendar-event-actions.service';
import { IssueService } from '../issue/issue.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterResolverService } from '../issue/two-way-sync/issue-sync-adapter-resolver.service';
import { CalendarIntegrationService } from './calendar-integration.service';
import { HiddenCalendarEventsService } from './hidden-calendar-events.service';
import { SnackService } from '../../core/snack/snack.service';
import { IssueSyncAdapter } from '../issue/two-way-sync/issue-sync-adapter.interface';
import { ScheduleFromCalendarEvent } from '../schedule/schedule.model';
import { IssueProviderPluginType } from '../issue/issue.model';
import { Log } from '../../core/log';
import { T } from '../../t.const';

describe('CalendarEventActionsService', () => {
  let service: CalendarEventActionsService;
  let store: jasmine.SpyObj<Store>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let pluginRegistry: jasmine.SpyObj<PluginIssueProviderRegistryService>;
  let adapterResolver: jasmine.SpyObj<IssueSyncAdapterResolverService>;
  let calendarIntegrationService: jasmine.SpyObj<CalendarIntegrationService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let adapter: jasmine.SpyObj<IssueSyncAdapter<unknown>>;

  const providerCfg: IssueProviderPluginType = {
    id: 'provider-1',
    isEnabled: true,
    issueProviderKey: 'plugin:google-calendar-provider',
    pluginId: 'google-calendar-provider',
    pluginConfig: { readCalendarIds: ['primary'] },
  };

  const createCalendarEvent = (
    overrides: Partial<ScheduleFromCalendarEvent> = {},
  ): ScheduleFromCalendarEvent => ({
    id: 'cal-1:event-1',
    calProviderId: 'provider-1',
    issueProviderKey: 'plugin:google-calendar-provider',
    title: 'Meeting',
    start: new Date('2026-03-20T10:00:00').getTime(),
    duration: 30 * 60 * 1000,
    isAllDay: false,
    icon: 'event',
    ...overrides,
  });

  beforeEach(() => {
    store = jasmine.createSpyObj<Store>('Store', ['select']);
    store.select.and.returnValue(of(providerCfg));
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    pluginRegistry = jasmine.createSpyObj<PluginIssueProviderRegistryService>(
      'PluginIssueProviderRegistryService',
      ['getProvider'],
    );
    pluginRegistry.getProvider.and.returnValue({
      definition: { updateIssue: jasmine.createSpy('updateIssue') },
    } as any);
    adapter = jasmine.createSpyObj<IssueSyncAdapter<unknown>>('IssueSyncAdapter', [
      'getFieldMappings',
      'getSyncConfig',
      'fetchIssue',
      'pushChanges',
      'extractSyncValues',
    ]);
    adapter.pushChanges.and.resolveTo();
    adapterResolver = jasmine.createSpyObj<IssueSyncAdapterResolverService>(
      'IssueSyncAdapterResolverService',
      ['getAdapter'],
    );
    adapterResolver.getAdapter.and.returnValue(adapter);
    calendarIntegrationService = jasmine.createSpyObj<CalendarIntegrationService>(
      'CalendarIntegrationService',
      ['triggerRefresh'],
    );
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        CalendarEventActionsService,
        { provide: Store, useValue: store },
        { provide: IssueService, useValue: {} },
        { provide: MatDialog, useValue: matDialog },
        { provide: PluginIssueProviderRegistryService, useValue: pluginRegistry },
        { provide: IssueSyncAdapterResolverService, useValue: adapterResolver },
        { provide: CalendarIntegrationService, useValue: calendarIntegrationService },
        { provide: HiddenCalendarEventsService, useValue: {} },
        { provide: SnackService, useValue: snackService },
      ],
    });

    service = TestBed.inject(CalendarEventActionsService);
  });

  it('returns false without loading provider config when no adapter exists', async () => {
    adapterResolver.getAdapter.and.returnValue(undefined);

    const wasMoved = await service.moveToStartTime(
      createCalendarEvent(),
      new Date('2026-03-22T14:30:00').getTime(),
    );

    expect(wasMoved).toBeFalse();
    expect(store.select).not.toHaveBeenCalled();
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('logs sanitized errors and reports failed writes', async () => {
    const error = {
      name: 'HttpErrorResponse',
      message:
        'Http failure response for https://www.googleapis.com/calendar/v3/calendars/noam@example.com/events/1: 403 Forbidden',
      status: 403,
      statusText: 'Forbidden',
      url: 'https://www.googleapis.com/calendar/v3/calendars/noam@example.com/events/1',
    };
    adapter.pushChanges.and.rejectWith(error);
    const logSpy = spyOn(Log, 'err');

    const wasMoved = await service.moveToStartTime(
      createCalendarEvent(),
      new Date('2026-03-22T14:30:00').getTime(),
    );

    expect(wasMoved).toBeFalse();
    expect(logSpy).toHaveBeenCalledWith('Failed to move calendar event', {
      name: 'HttpErrorResponse',
      status: 403,
      statusText: 'Forbidden',
    });
    expect(JSON.stringify(logSpy.calls.mostRecent().args)).not.toContain(
      'noam@example.com',
    );
    expect(snackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: 'ERROR',
        translateParams: { errTxt: '403 Forbidden' },
      }),
    );
  });

  it('offers undo that restores the original timed event values', async () => {
    await service.moveToStartTime(
      createCalendarEvent(),
      new Date('2026-03-22T14:30:00').getTime(),
    );

    const successSnack = snackService.open.calls.mostRecent().args[0] as {
      actionStr?: string;
      actionFn?: () => Promise<boolean>;
    };
    expect(successSnack.actionStr).toBe(T.G.UNDO);

    await successSnack.actionFn!();

    expect(adapter.pushChanges.calls.mostRecent().args).toEqual([
      'cal-1:event-1',
      {
        ['start_dateTime']: new Date('2026-03-20T10:00:00').toISOString(),
        duration_ms: 30 * 60 * 1000,
      },
      providerCfg,
    ]);
  });

  it('uses the same write path for dialog reschedule', async () => {
    matDialog.open.and.returnValue({
      afterClosed: () => of({ date: '2026-03-23', time: '09:15' }),
    } as any);

    await service.reschedule(createCalendarEvent());

    expect(adapter.pushChanges).toHaveBeenCalledWith(
      'cal-1:event-1',
      jasmine.objectContaining({
        duration_ms: 30 * 60 * 1000,
      }),
      providerCfg,
    );
    expect(calendarIntegrationService.triggerRefresh).toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ actionStr: T.G.UNDO }),
    );
  });

  it('reschedules all-day events with a date-only change from dialog Date values', async () => {
    matDialog.open.and.returnValue({
      afterClosed: () => of({ date: new Date(2026, 2, 23), time: null }),
    } as any);

    await service.reschedule(
      createCalendarEvent({
        isAllDay: true,
        start: new Date(2026, 2, 20).getTime(),
        duration: 24 * 60 * 60 * 1000,
      }),
    );

    expect(adapter.pushChanges).toHaveBeenCalledWith(
      'cal-1:event-1',
      { start_date: '2026-03-23' },
      providerCfg,
    );
  });

  it('does not open the reschedule dialog when the provider cannot update events', async () => {
    pluginRegistry.getProvider.and.returnValue({ definition: {} } as any);

    await service.reschedule(createCalendarEvent());

    expect(matDialog.open).not.toHaveBeenCalled();
    expect(adapter.pushChanges).not.toHaveBeenCalled();
  });
});
