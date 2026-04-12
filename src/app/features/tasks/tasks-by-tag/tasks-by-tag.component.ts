import { ChangeDetectionStrategy, Component, inject, input, Input } from '@angular/core';
import { T } from 'src/app/t.const';
import { Task } from '../task.model';
import { unique } from '../../../util/unique';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, withLatestFrom } from 'rxjs/operators';
import { DateService } from '../../../core/date/date.service';
import { Store } from '@ngrx/store';
import { selectAllTags } from '../../tag/store/tag.reducer';
import { Tag } from '../../tag/tag.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { AsyncPipe } from '@angular/common';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TagComponent } from '../../tag/tag/tag.component';

interface TagWithTimeSpent {
  id: string;
  tag: Tag;
  timeSpentToday: number;
}

@Component({
  selector: 'tasks-by-tag',
  templateUrl: './tasks-by-tag.component.html',
  styleUrls: ['./tasks-by-tag.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, MsToStringPipe, TranslatePipe, TagComponent],
})
export class TasksByTagComponent {
  private readonly _store = inject(Store);
  private readonly _dateService = inject(DateService);

  T: typeof T = T;
  readonly dayStr = input<string>(this._dateService.todayStr());
  readonly isForToday = input<boolean>(true);
  readonly isShowYesterday = input<boolean>(false);
  flatTasks: Task[] = [];
  todaysTasksTagIds$: BehaviorSubject<string[]> = new BehaviorSubject<string[]>([]);
  tagsWithTimeSpent$: Observable<TagWithTimeSpent[]> = this.todaysTasksTagIds$.pipe(
    withLatestFrom(this._store.select(selectAllTags)),
    map(([tagIds, allTags]) => {
      // NOTE: the order is like the ones in the menu
      const mappedTags = allTags
        .filter((tag) => tagIds.includes(tag.id))
        .map((tag) => this._mapToTagWithTasks(tag));
      return mappedTags.sort((a, b) => b.timeSpentToday - a.timeSpentToday);
    }),
  );

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input('flatTasks') set flatTasksIn(tasks: Task[]) {
    this.flatTasks = tasks;
    const tagIds: string[] = unique(
      tasks.reduce((acc, t) => [...acc, ...t.tagIds], [] as string[]),
    );
    this.todaysTasksTagIds$.next(tagIds);
  }

  trackById(i: number, item: Tag): string {
    return item.id;
  }

  private _mapToTagWithTasks(tag: Tag): TagWithTimeSpent {
    // if (this.isShowYesterday && this.isForToday) {
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayDayStr = getDbDateStr(yesterdayDate);

    const tagWithTasks: TagWithTimeSpent = {
      id: tag.id,
      tag,
      timeSpentToday: this.flatTasks
        .filter((task) => task.tagIds.includes(tag.id))
        .reduce((acc, task) => {
          let v: number = task.timeSpentOnDay?.[this.dayStr()] || 0;
          if (this.isShowYesterday() && this.isForToday()) {
            v = v + (task.timeSpentOnDay?.[yesterdayDayStr] || 0);
          }
          return acc + v;
        }, 0),
    };

    return tagWithTasks;
  }
}
