import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { Task, TaskCopy } from '../../../tasks/task.model';
import { IssueServiceInterface } from '../../issue-service-interface';
import {
  IssueData,
  IssueDataReduced,
  IssueProviderCalendar,
  SearchResultItem,
} from '../../issue.model';
import { CalendarIntegrationService } from '../../../calendar-integration/calendar-integration.service';
import { first, map, switchMap } from 'rxjs/operators';
import { matchesAnyCalendarEventId } from '../../../calendar-integration/get-calendar-event-id-candidates';
import { IssueProviderService } from '../../issue-provider.service';
import { CalendarProviderCfg, ICalIssueReduced } from './calendar.model';
import { HttpClient } from '@angular/common/http';
import { ICAL_TYPE } from '../../issue.const';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { CALENDAR_POLL_INTERVAL } from './calendar.const';

@Injectable({
  providedIn: 'root',
})
export class CalendarCommonInterfacesService implements IssueServiceInterface {
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _issueProviderService = inject(IssueProviderService);
  private _http = inject(HttpClient);

  isEnabled(cfg: IssueProviderCalendar): boolean {
    return cfg.isEnabled && cfg.icalUrl?.length > 0;
  }

  pollInterval: number = CALENDAR_POLL_INTERVAL;

  issueLink(issueId: number, issueProviderId: string): Promise<string> {
    return Promise.resolve('NONE');
  }

  testConnection(cfg: CalendarProviderCfg): Promise<boolean> {
    return this._calendarIntegrationService.testConnection(cfg);
  }

  getById(id: number, issueProviderId: string): Promise<IssueData | null> {
    return Promise.resolve(null);
  }

  getAddTaskData(
    calEv: ICalIssueReduced,
  ): Partial<Readonly<TaskCopy>> & { title: string } {
    // For all-day events, use dueDay instead of dueWithTime
    // This prevents them from cluttering the schedule timeline
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

  async searchIssues(
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

  async getFreshDataForIssueTask(task: Task): Promise<{
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

  async getFreshDataForIssueTasks(tasks: Task[]): Promise<
    {
      task: Readonly<Task>;
      taskChanges: Partial<Readonly<Task>>;
      issue: IssueData;
    }[]
  > {
    // Group tasks by provider to minimize fetches
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
    issueProviderId: string,
    allExistingIssueIds: number[],
  ): Promise<IssueDataReduced[]> {
    return [];
  }

  private _getCfgOnce$(issueProviderId: string): Observable<IssueProviderCalendar> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'ICAL');
  }
}
