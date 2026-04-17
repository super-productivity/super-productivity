import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  catchError,
  distinctUntilChanged,
  first,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';
import { getRelevantEventsForCalendarIntegrationFromIcal } from '../schedule/ical/get-relevant-events-from-ical';
import {
  BehaviorSubject,
  combineLatest,
  defer,
  forkJoin,
  from,
  merge,
  Observable,
  of,
  Subject,
  timer,
} from 'rxjs';
import { T } from '../../t.const';
import { SnackService } from '../../core/snack/snack.service';
import { getStartOfDayTimestamp } from '../../util/get-start-of-day-timestamp';
import { getEndOfDayTimestamp } from '../../util/get-end-of-day-timestamp';
import { CalendarIntegrationEvent } from './calendar-integration.model';
import { fastArrayCompare } from '../../util/fast-array-compare';
import { selectAllCalendarTaskEventIds } from '../tasks/store/task.selectors';
import { loadFromRealLs, saveToRealLs } from '../../core/persistence/local-storage';
import { LS } from '../../core/persistence/storage-keys.const';
import { Store } from '@ngrx/store';
import {
  ScheduleCalendarMapEntry,
  ScheduleFromCalendarEvent,
} from '../schedule/schedule.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { selectCalendarProviders } from '../issue/store/issue-provider.selectors';
import {
  IssueProviderCalendar,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../issue/issue.model';
import { CalendarProviderCfg } from '../issue/providers/calendar/calendar.model';
import { CORS_SKIP_EXTRA_HEADERS, IS_WEB_BROWSER } from '../../app.constants';
import { Log } from '../../core/log';
import { getErrorTxt } from '../../util/get-error-text';
import {
  getCalendarEventIdCandidates,
  matchesAnyCalendarEventId,
} from './get-calendar-event-id-candidates';
import { getEffectiveCheckInterval } from '../issue/providers/calendar/calendar.const';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../plugins/issue-provider/plugin-http.service';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { PluginSearchResult } from '../../plugins/issue-provider/plugin-issue-provider.model';
import { HiddenCalendarEventsService } from './hidden-calendar-events.service';

const ONE_MONTHS = 60 * 60 * 1000 * 24 * 31;
const PLUGIN_CALENDAR_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

@Injectable({
  providedIn: 'root',
})
export class CalendarIntegrationService {
  private _http = inject(HttpClient);
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private _pluginHttp = inject(PluginHttpService);
  private _hiddenEventsService = inject(HiddenCalendarEventsService);
  private _refreshTrigger$ = new Subject<void>();

  calendarEvents$: Observable<ScheduleCalendarMapEntry[]> = merge(
    // NOTE: we're using this rather than startWith since we want to use the freshest available cached value
    defer(() => of(this._getCalProviderFromCache())),
    combineLatest([
      this._store
        .select(selectCalendarProviders)
        .pipe(distinctUntilChanged(fastArrayCompare)),
      this._store.select(selectEnabledIssueProviders).pipe(
        map((providers) =>
          providers.filter(
            (p): p is IssueProviderPluginType =>
              isPluginIssueProvider(p.issueProviderKey) &&
              this._pluginRegistry.getUseAgendaView(p.issueProviderKey),
          ),
        ),
        distinctUntilChanged(fastArrayCompare),
      ),
    ]).pipe(
      switchMap(([icalProviders, pluginCalProviders]) => {
        if (!icalProviders?.length && !pluginCalProviders?.length) {
          return of([]) as Observable<ScheduleCalendarMapEntry[]>;
        }
        const minInterval = this._getCombinedRefreshInterval(
          icalProviders,
          pluginCalProviders,
        );
        return merge(timer(0, minInterval), this._refreshTrigger$).pipe(
          switchMap(() => this._fetchAllCombined(icalProviders, pluginCalProviders)),
        );
      }),
    ),
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  triggerRefresh(): void {
    this._refreshTrigger$.next();
  }

  private _fetchAllCombined(
    icalProviders: IssueProviderCalendar[],
    pluginCalProviders: IssueProviderPluginType[],
  ): Observable<ScheduleCalendarMapEntry[]> {
    const icalFetches = icalProviders.map((calProvider) => {
      if (!calProvider.isEnabled) {
        return of({
          itemsForProvider: [] as CalendarIntegrationEvent[],
          providerId: calProvider.id,
          didError: false,
        });
      }
      return this.requestEventsForSchedule$(calProvider, true).pipe(
        first(),
        map((itemsForProvider: CalendarIntegrationEvent[]) => ({
          itemsForProvider,
          providerId: calProvider.id,
          didError: false,
        })),
        catchError(() =>
          of({
            itemsForProvider: [] as CalendarIntegrationEvent[],
            providerId: calProvider.id,
            didError: true,
          }),
        ),
      );
    });

    const pluginFetches = pluginCalProviders.map((pluginProvider) =>
      from(this._fetchPluginCalendarEvents(pluginProvider)).pipe(
        map((itemsForProvider) => ({
          itemsForProvider,
          providerId: pluginProvider.id,
          didError: false,
        })),
        catchError((err) => {
          Log.warn('Failed to fetch plugin calendar events', err);
          return of({
            itemsForProvider: [] as CalendarIntegrationEvent[],
            providerId: pluginProvider.id,
            didError: true,
          });
        }),
      ),
    );

    const allFetches = [...icalFetches, ...pluginFetches];
    if (!allFetches.length) {
      return of([]);
    }

    return forkJoin(allFetches).pipe(
      switchMap((resultForProviders) =>
        combineLatest([
          this._store
            .select(selectAllCalendarTaskEventIds)
            .pipe(distinctUntilChanged(fastArrayCompare)),
          this.skippedEventIds$.pipe(distinctUntilChanged(fastArrayCompare)),
          this._hiddenEventsService.hiddenEventIds$.pipe(
            distinctUntilChanged(fastArrayCompare),
          ),
        ]).pipe(
          map(([allCalendarTaskEventIds, skippedEventIds, hiddenEventIds]) => {
            const cachedByProviderId = this._groupCachedEventsByProvider(
              this._getCalProviderFromCache(),
            );
            return resultForProviders.map(
              ({ itemsForProvider, providerId, didError }) => {
                const sourceItems: ScheduleFromCalendarEvent[] = didError
                  ? (cachedByProviderId.get(providerId) ?? [])
                  : (itemsForProvider as ScheduleFromCalendarEvent[]);
                return {
                  items: sourceItems.filter(
                    (calEv) =>
                      !matchesAnyCalendarEventId(calEv, allCalendarTaskEventIds) &&
                      !matchesAnyCalendarEventId(calEv, skippedEventIds) &&
                      !matchesAnyCalendarEventId(calEv, hiddenEventIds),
                  ),
                } as ScheduleCalendarMapEntry;
              },
            );
          }),
        ),
      ),
      tap((val) => {
        saveToRealLs(LS.CAL_EVENTS_CACHE, val);
      }),
    );
  }

  private async _fetchPluginCalendarEvents(
    pluginProvider: IssueProviderPluginType,
  ): Promise<CalendarIntegrationEvent[]> {
    const provider = this._pluginRegistry.getProvider(pluginProvider.issueProviderKey);
    if (!provider?.definition.getNewIssuesForBacklog) {
      return [];
    }

    const http = this._pluginHttp.createHttpHelper(
      () => Promise.resolve(provider.definition.getHeaders(pluginProvider.pluginConfig)),
      { allowPrivateNetwork: provider.allowPrivateNetwork },
    );
    const results: PluginSearchResult[] =
      await provider.definition.getNewIssuesForBacklog(pluginProvider.pluginConfig, http);

    return results
      .filter((r) => r.start != null)
      .map((r) => ({
        id: r.id,
        calProviderId: pluginProvider.id,
        title: r.title,
        description: r.description,
        start: r.start!,
        duration: r.duration ?? 0,
        isAllDay: r.isAllDay,
        issueProviderKey: pluginProvider.issueProviderKey,
        dueWithTime: r.dueWithTime,
      }));
  }

  private _getCombinedRefreshInterval(
    icalProviders: IssueProviderCalendar[],
    pluginCalProviders: IssueProviderPluginType[],
  ): number {
    const intervals: number[] = [];
    const enabledIcal = icalProviders.filter((p) => p.isEnabled && p.icalUrl);
    if (enabledIcal.length) {
      intervals.push(...enabledIcal.map((p) => getEffectiveCheckInterval(p)));
    }
    if (pluginCalProviders.length) {
      intervals.push(
        ...pluginCalProviders.map((p) => {
          const reg = this._pluginRegistry.getProvider(p.issueProviderKey);
          return reg?.pollIntervalMs ?? PLUGIN_CALENDAR_POLL_INTERVAL;
        }),
      );
    }
    return intervals.length ? Math.min(...intervals) : 2 * 60 * 60 * 1000;
  }

  public readonly skippedEventIds$ = new BehaviorSubject<string[]>([]);

  constructor() {
    if (localStorage.getItem(LS.CALENDER_EVENTS_LAST_SKIP_DAY) === getDbDateStr()) {
      try {
        const skippedEvIds = JSON.parse(
          localStorage.getItem(LS.CALENDER_EVENTS_SKIPPED_TODAY) as string,
        );
        this.skippedEventIds$.next(skippedEvIds || []);
      } catch (e) {
        Log.warn('Failed to parse skipped calendar event IDs from localStorage', e);
      }
    }
  }

  testConnection(cfg: CalendarProviderCfg): Promise<boolean> {
    //  simple http get request
    return this._http
      .get(cfg.icalUrl, {
        responseType: 'text',
        headers: {
          ...CORS_SKIP_EXTRA_HEADERS,
        },
      })
      .pipe(
        map((v) => !!v),
        catchError((err) => {
          Log.err(err);
          return of(false);
        }),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  skipCalendarEvent(calEv: CalendarIntegrationEvent): void {
    if (!calEv) {
      return;
    }

    const idsToAdd = getCalendarEventIdCandidates(calEv).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (!idsToAdd.length) {
      return;
    }

    const current = this.skippedEventIds$.getValue();
    const updated = [...current, ...idsToAdd.filter((id) => !current.includes(id))];
    this.skippedEventIds$.next(updated);
    localStorage.setItem(LS.CALENDER_EVENTS_SKIPPED_TODAY, JSON.stringify(updated));
    localStorage.setItem(LS.CALENDER_EVENTS_LAST_SKIP_DAY, getDbDateStr());
  }

  requestEvents$(
    calProvider: IssueProviderCalendar,
    start = getStartOfDayTimestamp(),
    end = getEndOfDayTimestamp(),
    isForwardError = false,
  ): Observable<CalendarIntegrationEvent[]> {
    // allow calendars to be disabled for web apps if CORS will fail to prevent errors
    if (calProvider.isDisabledForWebApp && IS_WEB_BROWSER) {
      return of([]);
    }
    return this._http
      .get(calProvider.icalUrl, {
        responseType: 'text',
        headers: {
          ...CORS_SKIP_EXTRA_HEADERS,
        },
      })
      .pipe(
        switchMap((icalStrData) =>
          getRelevantEventsForCalendarIntegrationFromIcal(
            icalStrData,
            calProvider.id,
            start,
            end,
            calProvider.icalUrl,
          ),
        ),
        catchError((err) => {
          Log.err(err);
          this._snackService.open({
            type: 'ERROR',
            msg: T.F.CALENDARS.S.CAL_PROVIDER_ERROR,
            translateParams: {
              errTxt: getErrorTxt(err),
            },
          });
          if (isForwardError) {
            throw new Error(err);
          }
          return of([]);
        }),
      );
  }

  requestEventsForSchedule$(
    calProvider: IssueProviderCalendar,
    isForwardError = false,
  ): Observable<CalendarIntegrationEvent[]> {
    return this.requestEvents$(
      calProvider,
      Date.now(),
      Date.now() + ONE_MONTHS,
      isForwardError,
    );
  }

  private _getCalProviderFromCache(): ScheduleCalendarMapEntry[] {
    const now = Date.now();
    const cached = loadFromRealLs(LS.CAL_EVENTS_CACHE);

    // Validate that cached data is an array
    if (!Array.isArray(cached)) {
      return [];
    }

    return (
      cached
        // filter out cached past entries
        .map((provider) => ({
          ...provider,
          items: provider.items
            .filter((item) => item.start + item.duration >= now)
            // Backfill issueProviderKey for events cached before it became required
            .map((item) =>
              item.issueProviderKey ? item : { ...item, issueProviderKey: 'ICAL' },
            ),
        }))
    );
  }

  private _groupCachedEventsByProvider(
    cachedEntries: ScheduleCalendarMapEntry[],
  ): Map<string, ScheduleFromCalendarEvent[]> {
    // Pre-group cached entries for quick lookups per provider when we need fallback data.
    const mapByProvider = new Map<string, ScheduleFromCalendarEvent[]>();

    cachedEntries.forEach((entry) => {
      entry.items.forEach((item) => {
        const existing = mapByProvider.get(item.calProviderId);
        if (existing) {
          existing.push(item);
        } else {
          mapByProvider.set(item.calProviderId, [item]);
        }
      });
    });

    return mapByProvider;
  }
}
