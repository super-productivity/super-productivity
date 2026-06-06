import { Injectable, inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { distinctUntilChanged, first, map, skip, switchMap, tap } from 'rxjs/operators';
import { BehaviorSubject, EMPTY, forkJoin, timer } from 'rxjs';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { BannerService } from '../../../core/banner/banner.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { CalendarIntegrationEvent } from '../calendar-integration.model';
import { isCalenderEventDue } from '../is-calender-event-due';
import { CalendarIntegrationService } from '../calendar-integration.service';
import { BannerId } from '../../../core/banner/banner.model';
import { selectTaskByIssueId } from '../../tasks/store/task.selectors';
import { NavigateToTaskService } from '../../../core-ui/navigate-to-task/navigate-to-task.service';
import { T } from '../../../t.const';
import { isValidUrl } from '../../../util/is-valid-url';
import { getPluralKey } from '../../../util/get-plural-key';
import { distinctUntilChangedObject } from '../../../util/distinct-until-changed-object';
import { selectCalendarProviders } from '../../issue/store/issue-provider.selectors';
import { IssueProviderCalendar, IssueProviderKey } from '../../issue/issue.model';
import { IssueService } from '../../issue/issue.service';
import { DateService } from '../../../core/date/date.service';
import { TaskService } from '../../tasks/task.service';
import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { Log } from '../../../core/log';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import {
  getCalendarEventIdCandidates,
  matchesAnyCalendarEventId,
  shareCalendarEventId,
} from '../get-calendar-event-id-candidates';
import { getEffectiveCheckInterval } from '../../issue/providers/calendar/calendar.const';
import { passesCalendarEventRegexFilter } from '../calendar-event-regex-filter';

const CHECK_TO_SHOW_INTERVAL = 60 * 1000;

@Injectable()
export class CalendarIntegrationEffects {
  private _store = inject(Store);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _bannerService = inject(BannerService);
  private _taskService = inject(TaskService);
  private _datePipe = inject(LocaleDatePipe);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _navigateToTaskService = inject(NavigateToTaskService);
  private _issueService = inject(IssueService);
  private _dateService = inject(DateService);
  private _translateService = inject(TranslateService);
  private _translateStore = inject(TranslateStore);
  private _syncTriggerService = inject(SyncTriggerService);
  private _hydrationStateService = inject(HydrationStateService);

  /**
   * Poll external calendar providers for events and auto-import them as tasks.
   *
   * The auto-import branch is gated on `isInitialSyncDoneSync() &&
   * !isInSyncWindow()` — the same predicate as `skipDuringSyncWindow()`
   * (see `src/app/util/skip-during-sync-window.operator.ts`). We hand-roll
   * it here rather than using the operator because:
   *   1. The operator filters emissions on a stream; this effect runs its
   *      side effects inside `tap(async () => …)`, not on an emission.
   *   2. The banner-display branch (further down in the same tap) must
   *      keep firing during sync, so the gate cannot be lifted to the
   *      outer pipe.
   * Refactoring the tap into `exhaustMap(...) → skipDuringSyncWindow() →
   * tap(import)` would let the operator be reused; left as a follow-up.
   *
   * Why the gate matters: calendar task IDs are deterministic across devices
   * (see `generateCalendarTaskId`), so a pre-first-sync import on a second
   * client emits a CRT op on the same entity id as the remote one →
   * conflict. Discussion #7677.
   */
  pollChanges$ = createEffect(
    () =>
      this._globalTrackingIntervalService.todayDateStr$.pipe(
        switchMap(() => this._store.select(selectCalendarProviders)),
        map((calProviders) => {
          return calProviders.filter(
            (calProvider) =>
              calProvider.isEnabled &&
              calProvider.icalUrl &&
              isValidUrl(calProvider.icalUrl),
          );
        }),
        distinctUntilChanged(distinctUntilChangedObject),
        switchMap((activatedProviders) => {
          if (!activatedProviders.length) {
            return EMPTY;
          }
          const now = Date.now();
          // const startTS = now - START_OFFSET;

          return forkJoin(
            activatedProviders.map((calProvider) =>
              timer(0, getEffectiveCheckInterval(calProvider)).pipe(
                // tap(() => Log.log('REQUEST CALENDAR', calProvider)),
                switchMap(() =>
                  this._calendarIntegrationService.requestEvents$(calProvider),
                ),
                switchMap((allEventsToday) =>
                  timer(0, CHECK_TO_SHOW_INTERVAL).pipe(
                    tap(async () => {
                      const isAutoImportAllowed =
                        calProvider.isAutoImportForCurrentDay &&
                        this._syncTriggerService.isInitialSyncDoneSync() &&
                        !this._hydrationStateService.isInSyncWindow();
                      let allIssueIdsForProvider: string[] | undefined;
                      const getAllIssueIdsForProvider = async (): Promise<string[]> => {
                        if (!allIssueIdsForProvider) {
                          allIssueIdsForProvider =
                            await this._taskService.getAllIssueIdsForProviderEverywhere(
                              calProvider.id,
                            );
                        }
                        return allIssueIdsForProvider;
                      };

                      if (isAutoImportAllowed) {
                        const allIssueIds = await getAllIssueIdsForProvider();
                        // Re-check after the IDB read: a sync window can open
                        // during the await (e.g. tab resume → openSyncWindow()),
                        // and importing now would still emit a duplicate CRT op.
                        if (!this._hydrationStateService.isInSyncWindow()) {
                          allEventsToday.forEach((calEv) => {
                            if (
                              passesCalendarEventRegexFilter(
                                calEv,
                                calProvider.filterIncludeRegex,
                                calProvider.filterExcludeRegex,
                              ) &&
                              this._dateService.isToday(calEv.start) &&
                              !matchesAnyCalendarEventId(calEv, allIssueIds)
                            ) {
                              this._issueService.addTaskFromIssue({
                                issueProviderKey:
                                  (calEv.issueProviderKey as IssueProviderKey) || 'ICAL',
                                issueProviderId: calProvider.id,
                                issueDataReduced: calEv,
                                // from this context we should always add to the default project rather than current context
                                isForceDefaultProject: true,
                              });
                            }
                          });
                        }
                      }

                      const dueEventsToShowBannerFor = allEventsToday.filter(
                        (calEv) =>
                          passesCalendarEventRegexFilter(
                            calEv,
                            calProvider.filterIncludeRegex,
                            calProvider.filterExcludeRegex,
                          ) &&
                          isCalenderEventDue(
                            calEv,
                            calProvider,
                            this._calendarIntegrationService.skippedEventIds$.getValue(),
                            now,
                          ) &&
                          !calEv.isReferenceCalendar,
                      );
                      const eventsToShowBannerFor: CalendarIntegrationEvent[] = [];
                      const archivedLinkedEvents: CalendarIntegrationEvent[] = [];
                      for (const calEv of dueEventsToShowBannerFor) {
                        if (await this._isLinkedToArchivedTask(calEv, calProvider)) {
                          archivedLinkedEvents.push(calEv);
                        } else {
                          eventsToShowBannerFor.push(calEv);
                        }
                      }
                      this._removeArchivedLinkedBanners(archivedLinkedEvents);
                      eventsToShowBannerFor.forEach((calEv) => {
                        this._addEvToShow(calEv, calProvider);
                      });
                      // this._showBanner(calEv, calProvider),
                    }),
                  ),
                ),
              ),
            ),
          );
        }),
        tap((a) => Log.log('_____END___', a)),
      ),
    { dispatch: false },
  );

  private _currentlyShownBanners$ = new BehaviorSubject<
    { id: string; calEv: CalendarIntegrationEvent; calProvider: IssueProviderCalendar }[]
  >([]);
  showBanner = createEffect(
    () => this._currentlyShownBanners$.pipe(tap((v) => this._showOrHideBanner(v))),
    {
      dispatch: false,
    },
  );

  reconcileBannersOnProviderChange = createEffect(
    () =>
      this._store.select(selectCalendarProviders).pipe(
        skip(1),
        tap((providers) => {
          const providerMap = new Map(providers.map((p) => [p.id, p]));
          const current = this._currentlyShownBanners$.getValue();
          const filtered = current.filter(({ calEv, calProvider }) => {
            const cfg = providerMap.get(calProvider.id);
            if (!cfg) return false;
            return passesCalendarEventRegexFilter(
              calEv,
              cfg.filterIncludeRegex,
              cfg.filterExcludeRegex,
            );
          });
          if (filtered.length !== current.length) {
            this._currentlyShownBanners$.next(filtered);
          }
        }),
      ),
    { dispatch: false },
  );

  private _addEvToShow(
    calEv: CalendarIntegrationEvent,
    calProvider: IssueProviderCalendar,
  ): void {
    const curVal = this._currentlyShownBanners$.getValue();
    Log.log('addEvToShow', curVal, calEv);
    if (curVal.some((val) => shareCalendarEventId(val.calEv, calEv))) {
      return;
    }

    const newBanners = [...curVal, { id: calEv.id, calEv, calProvider }];
    newBanners.sort((a, b) => a.calEv.start - b.calEv.start);
    Log.log('UDATE _currentlyShownBanners$');

    this._currentlyShownBanners$.next(newBanners);
  }

  private _skipEv(calEv: CalendarIntegrationEvent): void {
    this._calendarIntegrationService.skipCalendarEvent(calEv);
    this._currentlyShownBanners$.next(
      this._currentlyShownBanners$
        .getValue()
        .filter((v) => !shareCalendarEventId(v.calEv, calEv)),
    );
  }

  private async _showOrHideBanner(
    allEvsToShow: {
      id: string;
      calEv: CalendarIntegrationEvent;
      calProvider: IssueProviderCalendar;
    }[],
  ): Promise<void> {
    const firstEntry = allEvsToShow[0];
    if (!firstEntry) {
      this._bannerService.dismiss(BannerId.CalendarEvent);
      return;
    }
    const { calEv, calProvider } = firstEntry;
    const taskForEvent = await this._store
      .select(selectTaskByIssueId, {
        issueId: calEv.id,
        issueIdCandidates: getCalendarEventIdCandidates(calEv),
      })
      .pipe(first())
      .toPromise();

    const start = this._datePipe.transform(calEv.start, 'shortTime') as string;
    const isInPast = calEv.start < Date.now();

    const nrOfAllBanners = allEvsToShow.length;
    Log.log({ taskForEvent, allEvsToShow });

    this._bannerService.open({
      id: BannerId.CalendarEvent,
      ico: calProvider.icon || 'event',
      msg:
        nrOfAllBanners === 1
          ? isInPast
            ? T.F.CALENDARS.BANNER.TXT_PAST
            : T.F.CALENDARS.BANNER.TXT
          : getPluralKey(
              this._translateService,
              this._translateStore,
              nrOfAllBanners - 1,
              isInPast
                ? 'F.CALENDARS.BANNER.TXT_PAST_MULTIPLE'
                : 'F.CALENDARS.BANNER.TXT_MULTIPLE',
            ),
      translateParams: {
        title: calEv.title,
        start,
        nrOfOtherBanners: nrOfAllBanners - 1,
      },
      action: {
        label: T.G.DISMISS,
        fn: () => {
          this._skipEv(calEv);
        },
      },
      action2: taskForEvent
        ? {
            label: T.F.CALENDARS.BANNER.SHOW_TASK,
            fn: () => {
              this._skipEv(calEv);
              this._navigateToTaskService.navigate(taskForEvent.id);
            },
          }
        : {
            label: T.F.CALENDARS.BANNER.ADD_AS_TASK,
            fn: () => {
              this._skipEv(calEv);
              this._issueService.addTaskFromIssue({
                issueProviderKey: (calEv.issueProviderKey as IssueProviderKey) || 'ICAL',
                issueProviderId: calProvider.id,
                issueDataReduced: calEv,
                // from the banner we should always add to the default project rather than current context
                isForceDefaultProject: true,
              });
            },
          },
    });
  }

  private async _isLinkedToArchivedTask(
    calEv: CalendarIntegrationEvent,
    calProvider: IssueProviderCalendar,
  ): Promise<boolean> {
    const issueProviderKey = (calEv.issueProviderKey as IssueProviderKey) || 'ICAL';
    const issueIdsToCheck = Array.from(
      new Set([calEv.id, ...getCalendarEventIdCandidates(calEv)]),
    );

    for (const issueId of issueIdsToCheck) {
      const linkedTask = await this._taskService.checkForTaskWithIssueEverywhere(
        issueId,
        issueProviderKey,
        calProvider.id,
      );
      if (linkedTask) {
        return linkedTask.isFromArchive;
      }
    }

    return false;
  }

  private _removeArchivedLinkedBanners(
    archivedLinkedEvents: CalendarIntegrationEvent[],
  ): void {
    if (!archivedLinkedEvents.length) {
      return;
    }

    const nextBanners = this._currentlyShownBanners$
      .getValue()
      .filter(
        ({ calEv }) =>
          !archivedLinkedEvents.some((archivedLinkedEvent) =>
            shareCalendarEventId(calEv, archivedLinkedEvent),
          ),
      );
    this._currentlyShownBanners$.next(nextBanners);
  }
}
