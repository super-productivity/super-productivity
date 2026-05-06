import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { combineLatest, from, Observable, of } from 'rxjs';
import { first, map } from 'rxjs/operators';
import { Task } from '../tasks/task.model';
import { ScheduleCalendarMapEntry } from './schedule.model';
import { selectTimeTrackingState } from '../time-tracking/store/time-tracking.selectors';
import { selectTimelineConfig } from '../config/store/global-config.reducer';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { TaskArchiveService } from '../archive/task-archive.service';
import { buildPastWorkCalendarEntries } from './map-schedule-data/build-past-work-calendar-entries';

@Injectable({
  providedIn: 'root',
})
export class PastWorkScheduleEntriesService {
  private _taskArchiveService = inject(TaskArchiveService);
  private _store = inject(Store);

  private _archiveCache: Task[] | null = null;

  buildEntriesForDays$(days: string[]): Observable<ScheduleCalendarMapEntry[]> {
    if (!days.length) return of([]);

    return combineLatest([
      this._store.select(selectAllTasks),
      this._store.select(selectTimeTrackingState),
      this._store.select(selectTimelineConfig),
      from(this._getArchiveTasks()),
    ]).pipe(
      first(),
      map(([currentTasks, ttState, timelineCfg, archiveTasks]) =>
        buildPastWorkCalendarEntries(
          days,
          currentTasks,
          archiveTasks,
          ttState,
          timelineCfg,
        ),
      ),
    );
  }

  clearCache(): void {
    this._archiveCache = null;
  }

  private async _getArchiveTasks(): Promise<Task[]> {
    if (this._archiveCache) return this._archiveCache;
    const archive = await this._taskArchiveService.load();
    this._archiveCache = (archive.ids as string[])
      .map((id) => archive.entities[id]!)
      .filter(Boolean);
    return this._archiveCache;
  }
}
