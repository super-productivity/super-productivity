import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { Task, TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import {
  IssueData,
  IssueDataReduced,
  IssueProviderCalendar,
  SearchResultItem,
} from '../../issue.model';
import { CalendarIntegrationService } from '../../../calendar-integration/calendar-integration.service';
import { first, map, switchMap } from 'rxjs/operators';
import { matchesAnyCalendarEventId } from '../../../calendar-integration/get-calendar-event-id-candidates';
import { ICalIssueReduced } from './calendar.model';
import { ICAL_TYPE } from '../../issue.const';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { CALENDAR_POLL_INTERVAL } from './calendar.const';

@Injectable({
  providedIn: 'root',
})
export class CalendarCommonInterfacesService extends BaseIssueProviderService<IssueProviderCalendar> {
  private _calendarIntegrationService = inject(CalendarIntegrationService);

  readonly providerKey = 'ICAL' as const;
  readonly pollInterval: number = CALENDAR_POLL_INTERVAL;

  isEnabled(cfg: IssueProviderCalendar): boolean {
    return cfg.isEnabled && cfg.icalUrl?.length > 0;
  }

  // Uses CalendarIntegrationService for connection testing
  testConnection(cfg: IssueProviderCalendar): Promise<boolean> {
    return this._calendarIntegrationService.testConnection(cfg);
  }

  issueLink(_issueId: number, _issueProviderId: string): Promise<string> {
    return Promise.resolve('NONE');
  }

  // Calendar events aren't fetched by ID
  override getById(_id: number, _issueProviderId: string): Promise<IssueData | null> {
    return Promise.resolve(null);
  }

  getAddTaskData(
    calEv: ICalIssueReduced,
  ): Partial<Readonly<TaskCopy>> & { title: string } {
    const dueDateFields = calEv.isAllDay
      ? { dueDay: getDbDateStr(calEv.start) }
      : { dueWithTime: calEv.start };

    return {
      title: calEv.title,
      issueId: calEv.id,
      issueProviderId: calEv.calProviderId,
      issueType: 'ICAL',
      timeEstimate: calEv.duration,
      notes: calEv.description || '',
      issueWasUpdated: false,
      issueLastUpdated: new Date().getTime(),
      ...dueDateFields,
    };
  }

  // Searches calendar events by title match
  override async searchIssues(
    query: string,
    issueProviderId: string,
  ): Promise<SearchResultItem[]> {
    const result = await firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((cfg) =>
          this._calendarIntegrationService.requestEventsForSchedule$(cfg, true),
        ),
        map((calEvents) =>
          calEvents
            .filter((calEvent) =>
              calEvent.title.toLowerCase().includes(query.toLowerCase()),
            )
            .map((calEvent) => ({
              title: calEvent.title,
              issueType: ICAL_TYPE,
              issueData: calEvent,
            })),
        ),
      ),
    );
    return result ?? [];
  }

  // Delegates to getFreshDataForIssueTasks for single-task refresh
  override async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: IssueData;
    issueTitle: string;
  } | null> {
    const results = await this.getFreshDataForIssueTasks([task]);
    if (!results.length) return null;
    return {
      taskChanges: results[0].taskChanges,
      issue: results[0].issue,
      issueTitle: (results[0].issue as unknown as ICalIssueReduced).title,
    };
  }

  // Compares event fields (time, title, duration) instead of timestamps
  override async getFreshDataForIssueTasks(tasks: Task[]): Promise<
    {
      task: Readonly<Task>;
      taskChanges: Partial<Readonly<Task>>;
      issue: IssueData;
    }[]
  > {
    const tasksByProvider = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.issueProviderId || !task.issueId) continue;
      const existing = tasksByProvider.get(task.issueProviderId) || [];
      existing.push(task);
      tasksByProvider.set(task.issueProviderId, existing);
    }

    const results: {
      task: Readonly<Task>;
      taskChanges: Partial<Readonly<Task>>;
      issue: IssueData;
    }[] = [];

    for (const [providerId, providerTasks] of tasksByProvider) {
      const cfg = await firstValueFrom(this._getCfgOnce$(providerId).pipe(first()));
      if (!cfg) continue;

      const events = await firstValueFrom(
        this._calendarIntegrationService
          .requestEventsForSchedule$(cfg, false)
          .pipe(first()),
      );
      if (!events?.length) continue;

      for (const task of providerTasks) {
        const matchingEvent = events.find((ev) =>
          matchesAnyCalendarEventId(ev, [task.issueId as string]),
        );
        if (!matchingEvent) continue;

        const taskData = this.getAddTaskData(matchingEvent);
        const hasChanges =
          taskData.dueWithTime !== task.dueWithTime ||
          taskData.dueDay !== task.dueDay ||
          taskData.title !== task.title ||
          taskData.timeEstimate !== task.timeEstimate;

        if (hasChanges) {
          results.push({
            task,
            taskChanges: { ...taskData, issueWasUpdated: true },
            issue: matchingEvent as unknown as IssueData,
          });
        }
      }
    }

    return results;
  }

  async getNewIssuesToAddToBacklog(
    _issueProviderId: string,
    _allExistingIssueIds: number[],
  ): Promise<IssueDataReduced[]> {
    return [];
  }

  // Not used since getById, searchIssues, getFreshData* are all overridden
  protected _apiGetById$(
    _id: string | number,
    _cfg: IssueProviderCalendar,
  ): Observable<IssueData | null> {
    return of(null);
  }

  protected _apiSearchIssues$(
    _searchTerm: string,
    _cfg: IssueProviderCalendar,
  ): Observable<SearchResultItem[]> {
    return of([]);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as unknown as ICalIssueReduced).title;
  }

  // Calendar compares event fields directly, not timestamps.
  // Safe: both getFreshDataForIssueTask and getFreshDataForIssueTasks are overridden,
  // which are the only callers of _getIssueLastUpdated.
  protected _getIssueLastUpdated(_issue: IssueData): number {
    return 0;
  }
}
