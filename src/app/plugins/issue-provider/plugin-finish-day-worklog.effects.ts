import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { BeforeFinishDayService } from '../../features/before-finish-day/before-finish-day.service';
import { selectAllTasksInActiveProjects } from '../../features/tasks/store/task.selectors';
import { Task } from '../../features/tasks/task.model';
import { SubmitWorklogForDayDialogData } from '../../features/issue/shared/dialog-submit-worklog-for-day/submit-worklog-for-day-dialog.model';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import {
  PluginTimeTrackingCtx,
  PluginTimeTrackingCtxService,
} from './plugin-time-tracking-ctx.service';

/** Well-known plugin config key that opts a provider into the finish-day dialog. */
export const SUBMIT_WORKLOG_ON_FINISH_DAY_KEY = 'isSubmitWorklogOnFinishDay';

/** Groups the tasks with time tracked on `day` by their issue provider. */
export const groupTasksWithTimeOnDay = (
  tasks: Task[],
  day: string,
): Map<string, Task[]> => {
  const byProvider = new Map<string, Task[]>();
  for (const task of tasks) {
    if (
      !task.issueId ||
      !task.issueProviderId ||
      !((task.timeSpentOnDay?.[day] ?? 0) > 0)
    ) {
      continue;
    }
    byProvider.set(task.issueProviderId, [
      ...(byProvider.get(task.issueProviderId) ?? []),
      task,
    ]);
  }
  return byProvider;
};

/**
 * Offers plugin issue providers with `timeTracking` to submit the day's unlogged
 * time when the user finishes a day. Runs from the local Finish Day flow only,
 * so remote ops never trigger it.
 */
@Injectable()
export class PluginFinishDayWorklogEffects {
  private readonly _store = inject(Store);
  private readonly _matDialog = inject(MatDialog);
  private readonly _ctxService = inject(PluginTimeTrackingCtxService);

  constructor() {
    // Finish Day awaits its registered actions; there is no action to listen to
    inject(BeforeFinishDayService).addAction(async (day) => {
      await this.submitWorklogForDay(day);
      return 'SUCCESS';
    });
  }

  /** Opens one dialog per opted-in provider, one after another. */
  async submitWorklogForDay(day: string): Promise<void> {
    // all contexts, not just today: `day` can be a past day from the daily summary
    const tasks = await firstValueFrom(
      this._store.select(selectAllTasksInActiveProjects),
    );
    for (const [issueProviderId, providerTasks] of groupTasksWithTimeOnDay(tasks, day)) {
      const cfg = await firstValueFrom(this._ctxService.getCfgOnce$(issueProviderId));
      const ctx = cfg?.isEnabled ? this._ctxService.buildCtx(cfg) : undefined;
      if (ctx?.pluginConfig[SUBMIT_WORKLOG_ON_FINISH_DAY_KEY]) {
        await this._openDialog(ctx, day, providerTasks);
      }
    }
  }

  private async _openDialog(
    ctx: PluginTimeTrackingCtx,
    day: string,
    tasks: Task[],
  ): Promise<void> {
    const { timeTracking, pluginConfig, http } = ctx;
    const getTimeLogged = timeTracking.getTimeLogged;
    const data: SubmitWorklogForDayDialogData = {
      day,
      tasks,
      providerName: ctx.providerName,
      icon: ctx.icon,
      getTimeLogged: getTimeLogged
        ? (issueId) => getTimeLogged(issueId, pluginConfig, http)
        : undefined,
      logTime: async (issueId, timeSpentMs) => {
        try {
          await timeTracking.logTime(
            issueId,
            // dated to the finished day, not to when the dialog is submitted
            { started: dateStrToUtcDate(day).getTime(), timeSpentMs, comment: '' },
            pluginConfig,
            http,
          );
        } catch (e) {
          this._ctxService.showError(ctx, e);
          throw e;
        }
      },
    };
    try {
      const { DialogSubmitWorklogForDayComponent } =
        await import('../../features/issue/shared/dialog-submit-worklog-for-day/dialog-submit-worklog-for-day.component');
      await firstValueFrom(
        this._matDialog
          .open(DialogSubmitWorklogForDayComponent, {
            restoreFocus: true,
            disableClose: true,
            closeOnNavigation: false,
            data,
          })
          .afterClosed(),
      );
    } catch (e) {
      // e.g. lazy chunk failed to load while offline; finishing the day goes on
      this._ctxService.showError(ctx, e);
    }
  }
}
