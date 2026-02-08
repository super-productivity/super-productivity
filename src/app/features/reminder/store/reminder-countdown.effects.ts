import { Injectable, inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import {
  selectAllTasksWithReminder,
  selectCurrentTaskId,
  selectTaskById,
} from '../../tasks/store/task.selectors';
import {
  concatMap,
  distinctUntilChanged,
  first,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import { BannerId } from '../../../core/banner/banner.model';
import { T } from '../../../t.const';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { Store } from '@ngrx/store';
import { BannerService } from '../../../core/banner/banner.service';
import { selectReminderConfig } from '../../config/store/global-config.reducer';
import { BehaviorSubject, combineLatest, EMPTY, timer } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { TaskWithReminder } from '../../tasks/task.model';
import { ProjectService } from '../../project/project.service';
import { Router } from '@angular/router';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Log } from '../../../core/log';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';

const UPDATE_PERCENTAGE_INTERVAL = 250;
// since the reminder modal doesn't show instantly we adjust a little for that
const COUNTDOWN_MAGIC_GAP = 500;

@Injectable()
export class ReminderCountdownEffects {
  private actions$ = inject(LOCAL_ACTIONS);
  private _datePipe = inject(LocaleDatePipe);
  private _store = inject(Store);
  private _bannerService = inject(BannerService);
  private _dataInitStateService = inject(DataInitStateService);
  private _taskService = inject(TaskService);
  private _projectService = inject(ProjectService);
  private _router = inject(Router);

  /**
   * SAFETY: Guarded with skipWhileApplyingRemoteOps() to prevent banner
   * flashing during sync when selectAllTasksWithReminder changes.
   */
  reminderCountdownBanner$ = createEffect(
    () =>
      this._dataInitStateService.isAllDataLoadedInitially$.pipe(
        concatMap(() => this._store.select(selectReminderConfig)),
        skipWhileApplyingRemoteOps(),
        switchMap((reminderCfg) =>
          reminderCfg.isCountdownBannerEnabled
            ? combineLatest([
                this._store.select(selectAllTasksWithReminder),
                this._skippedTaskIds$,
              ]).pipe(
                map(([tasksWithReminder, skippedTaskIds]) => {
                  const now = Date.now();
                  return tasksWithReminder.filter(
                    (task) =>
                      task.remindAt - reminderCfg.countdownDuration < now &&
                      // reminders due will show as an alert anyway
                      task.remindAt > now &&
                      !skippedTaskIds.includes(task.id),
                  );
                }),
                switchMap((dueTasks) =>
                  this._store.select(selectCurrentTaskId).pipe(
                    // currentTaskId is local UI state (not synced), so distinctUntilChanged is sufficient
                    distinctUntilChanged(),
                    map((currentId) => ({
                      currentId,
                      dueTasks: dueTasks.filter((t) => t.id !== currentId),
                    })),
                  ),
                ),
                tap(({ dueTasks }) => this._showBanner(dueTasks)),
              )
            : EMPTY,
        ),
      ),
    {
      dispatch: false,
    },
  );

  private _skippedTaskIds$ = new BehaviorSubject<string[]>([]);
  private _currentBannerTask?: TaskWithReminder;

  private _skipTask(taskId: string): void {
    this._skippedTaskIds$.next([...this._skippedTaskIds$.getValue(), taskId]);
  }

  private async _showBanner(dueTasks: TaskWithReminder[]): Promise<void> {
    const firstDue = dueTasks[0];
    if (!firstDue) {
      this._bannerService.dismiss(BannerId.ReminderCountdown);
      this._currentBannerTask = undefined;
      return;
    }
    if (
      this._currentBannerTask &&
      this._currentBannerTask.id === firstDue.id &&
      this._currentBannerTask.remindAt === firstDue.remindAt
    ) {
      // just leave banner as is
      return;
    }
    this._currentBannerTask = firstDue;

    const firstDueTask = await this._store
      .select(selectTaskById, { id: firstDue.id })
      .pipe(first())
      .toPromise();

    const showBannerStart = Date.now();
    const remainingAtBannerStart = firstDue.remindAt - showBannerStart;

    const startsAt = this._datePipe.transform(firstDue.remindAt, 'shortTime') as string;

    const nrOfAllBanners = dueTasks.length;
    Log.log({
      firstDueTask,
      firstDue,
      dueTasks,
    });

    this._bannerService.open({
      id: BannerId.ReminderCountdown,
      ico: 'alarm',
      msg:
        nrOfAllBanners > 1
          ? T.F.REMINDER.COUNTDOWN_BANNER.TXT_MULTIPLE
          : T.F.REMINDER.COUNTDOWN_BANNER.TXT,
      translateParams: {
        title: firstDueTask.title,
        start: startsAt,
        nrOfOtherBanners: nrOfAllBanners - 1,
      },
      action: {
        label: T.G.HIDE,
        fn: () => {
          this._skipTask(firstDue.id);
          this._currentBannerTask = undefined;
        },
      },
      action2: {
        label: T.F.REMINDER.COUNTDOWN_BANNER.START_NOW,
        fn: () => {
          this._skipTask(firstDue.id);
          this._currentBannerTask = undefined;
          this._startTask(firstDue);
        },
      },
      progress$: timer(0, UPDATE_PERCENTAGE_INTERVAL).pipe(
        map(() => {
          const now = Date.now();
          const elapsedTime = now - showBannerStart - COUNTDOWN_MAGIC_GAP;
          const percentage = (elapsedTime / remainingAtBannerStart) * 100;
          return percentage;
        }),
      ),
    });
  }

  private _startTask(task: TaskWithReminder): void {
    // Only dismiss the reminder, preserve dueDay/dueWithTime so task stays in Today
    this._store.dispatch(
      TaskSharedActions.dismissReminderOnly({
        id: task.id,
      }),
    );
    if (task.projectId) {
      if (task.parentId) {
        this._projectService.moveTaskToTodayList(task.parentId, task.projectId, true);
      } else {
        this._projectService.moveTaskToTodayList(task.id, task.projectId, true);
      }
    }
    this._taskService.setCurrentId(task.id);
    this._router.navigate(['/active/tasks']);
  }
}
