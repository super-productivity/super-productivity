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
  merge,
  Observable,
  of,
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
import { IssueProviderCalendar } from '../issue/issue.model';
import { CalendarProviderCfg } from '../issue/providers/calendar/calendar.model';
import { CORS_SKIP_EXTRA_HEADERS, IS_WEB_BROWSER } from '../../app.constants';
import { Log } from '../../core/log';
import { getErrorTxt } from '../../util/get-error-text';
import {
  getCalendarEventIdCandidates,
  matchesAnyCalendarEventId,
} from './get-calendar-event-id-candidates';
import { getEffectiveCheckInterval } from '../issue/providers/calendar/calendar.const';

const ONE_MONTHS = 60 * 60 * 1000 * 24 * 31;

@Injectable({
  providedIn: 'root',
})
export class CalendarIntegrationService {
  private _http = inject(HttpClient);
  private _snackService = inject(SnackService);
  private _store = inject(Store);

  icalEvents$: Observable<ScheduleCalendarMapEntry[]> = merge(
    // NOTE: we're using this rather than startWith since we want to use the freshest available cached value
    defer(() => of(this._getCalProviderFromCache())),
    this._store.select(selectCalendarProviders).pipe(
      distinctUntilChanged(fastArrayCompare),
      switchMap((calendarProviders) => {
        if (!calendarProviders?.length) {
          return of([]) as Observable<ScheduleCalendarMapEntry[]>;
        }
        // Calculate the minimum refresh interval from all enabled providers
        const minInterval = this._getMinRefreshInterval(calendarProviders);
        // Use timer to periodically refresh calendar data
        return timer(0, minInterval).pipe(
          switchMap(() => this._fetchAllProviders(calendarProviders)),
        );
      }),
    ),
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  private _fetchAllProviders(
    calendarProviders: IssueProviderCalendar[],
  ): Observable<ScheduleCalendarMapEntry[]> {
    return forkJoin(
      calendarProviders.map((calProvider) => {
        if (!calProvider.isEnabled) {
          return of({
            itemsForProvider: [] as CalendarIntegrationEvent[],
            calProvider,
            didError: false,
          });
        }

        return this.requestEventsForSchedule$(calProvider, true).pipe(
          first(),
          map((itemsForProvider: CalendarIntegrationEvent[]) => ({
            itemsForProvider,
            calProvider,
            didError: false,
          })),
          catchError(() =>
            of({
              itemsForProvider: [] as CalendarIntegrationEvent[],
              calProvider,
              didError: true,
            }),
          ),
        );
      }),
    ).pipe(
      switchMap((resultForProviders) =>
        combineLatest([
          this._store
            .select(selectAllCalendarTaskEventIds)
            .pipe(distinctUntilChanged(fastArrayCompare)),
          this.skippedEventIds$.pipe(distinctUntilChanged(fastArrayCompare)),
        ]).pipe(
          map(([allCalendarTaskEventIds, skippedEventIds]) => {
            const cachedByProviderId = this._groupCachedEventsByProvider(
              this._getCalProviderFromCache(),
            );
            return resultForProviders.map(
              ({ itemsForProvider, calProvider, didError }) => {
                // Fall back to cached data when the live fetch errored so offline mode keeps showing events.
                const sourceItems: ScheduleFromCalendarEvent[] = didError
                  ? (cachedByProviderId.get(calProvider.id) ?? [])
                  : (itemsForProvider as ScheduleFromCalendarEvent[]);
                return {
                  // filter out items already added as tasks
                  items: sourceItems.filter(
                    (calEv) =>
                      !matchesAnyCalendarEventId(calEv, allCalendarTaskEventIds) &&
                      !matchesAnyCalendarEventId(calEv, skippedEventIds),
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

  /**
   * Calculate the minimum refresh interval from all enabled providers.
   * Uses getEffectiveCheckInterval which returns 5 min for file:// URLs.
   */
  private _getMinRefreshInterval(calendarProviders: IssueProviderCalendar[]): number {
    const enabledProviders = calendarProviders.filter((p) => p.isEnabled && p.icalUrl);
    if (!enabledProviders.length) {
      return 2 * 60 * 60 * 1000; // Default 2 hours
    }
    return Math.min(...enabledProviders.map((p) => getEffectiveCheckInterval(p)));
  }

  public readonly skippedEventIds$ = new BehaviorSubject<string[]>([]);

  constructor() {
    // Log.log(
    //   localStorage.getItem(LS.CALENDER_EVENTS_LAST_SKIP_DAY),
    //   localStorage.getItem(LS.CALENDER_EVENTS_SKIPPED_TODAY),
    //   localStorage.getItem(LS.CAL_EVENTS_CACHE),
    // );

    if (localStorage.getItem(LS.CALENDER_EVENTS_LAST_SKIP_DAY) === getDbDateStr()) {
      try {
        const skippedEvIds = JSON.parse(
          localStorage.getItem(LS.CALENDER_EVENTS_SKIPPED_TODAY) as string,
        );
        this.skippedEventIds$.next(skippedEvIds || []);
      } catch (e) {}
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
    // Log.log('REQUEST EVENTS', calProvider, start, end);

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
          items: provider.items.filter((item) => item.start + item.duration >= now),
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
