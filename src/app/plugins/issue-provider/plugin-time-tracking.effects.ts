import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, from, Observable, of } from 'rxjs';
import { catchError, concatMap, filter, first, map, tap } from 'rxjs/operators';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginTimeTracking,
} from '@super-productivity/plugin-api';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { TaskService } from '../../features/tasks/task.service';
import { Task } from '../../features/tasks/task.model';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import { selectIssueProviderState } from '../../features/issue/store/issue-provider.selectors';
import { IssueProviderActions } from '../../features/issue/store/issue-provider.actions';
import { JiraWorklogExportDefaultTime } from '../../features/issue/providers/jira/jira.model';
import { TrackTimeDialogData } from '../../features/issue/shared/dialog-track-time/track-time-dialog.model';
import { SnackService } from '../../core/snack/snack.service';
import { getErrorTxt } from '../../util/get-error-text';
import { T } from '../../t.const';
import {
  PluginIssueProviderRegistryService,
  toPluginSvgIcon,
} from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';
import { withPluginOAuthTokenKey } from '../oauth/plugin-oauth-token-key.util';

/**
 * Picks the task to log time for after a task was marked done, or none.
 * Mirrors the former Redmine behavior: with "for each subtask" enabled, every
 * done subtask opens the dialog and the parent only does when it has none.
 */
export const getTimeTrackingDialogTask = (
  mainTask: Task,
  subTask: Task | undefined,
  pluginConfig: Record<string, unknown>,
): Task | undefined => {
  if (!pluginConfig['isShowTimeTrackingDialog']) {
    return undefined;
  }
  const isForEachSubTask = !!pluginConfig['isShowTimeTrackingDialogForEachSubTask'];
  if (subTask) {
    return isForEachSubTask ? subTask : undefined;
  }
  return !isForEachSubTask || !mainTask.subTaskIds.length ? mainTask : undefined;
};

interface TimeTrackingCtx {
  cfg: IssueProviderPluginType;
  definition: IssueProviderPluginDefinition;
  issueId: string;
  timeTracking: PluginTimeTracking;
  pluginConfig: Record<string, unknown>;
  http: PluginHttp;
  providerName: string;
  icon: string | undefined;
}

@Injectable()
export class PluginTimeTrackingEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _registry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttp = inject(PluginHttpService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _translateService = inject(TranslateService);

  openTrackTimeDialog$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => !!task),
        concatMap((task) =>
          task.parentId
            ? this._taskService
                .getByIdOnce$(task.parentId)
                .pipe(map((parent) => ({ mainTask: parent, subTask: task })))
            : of({ mainTask: task, subTask: undefined }),
        ),
        concatMap(({ mainTask, subTask }) =>
          this._getCtx$(mainTask).pipe(
            map((ctx) => ({
              ctx,
              task: ctx && getTimeTrackingDialogTask(mainTask, subTask, ctx.pluginConfig),
            })),
          ),
        ),
        tap(({ ctx, task }) => {
          if (ctx && task) {
            void this._openDialog(task, ctx);
          }
        }),
      ),
    { dispatch: false },
  );

  private _getCtx$(mainTask: Task | undefined): Observable<TimeTrackingCtx | undefined> {
    if (!mainTask?.issueId || !mainTask.issueProviderId) {
      return of(undefined);
    }
    const issueId = mainTask.issueId;
    return this._getCfgOnce$(mainTask.issueProviderId).pipe(
      map((cfg) => (cfg ? this._buildCtx(cfg, issueId) : undefined)),
    );
  }

  private _buildCtx(
    cfg: IssueProviderPluginType,
    issueId: string,
  ): TimeTrackingCtx | undefined {
    const provider = this._registry.getProvider(cfg.issueProviderKey);
    const timeTracking = provider?.definition.timeTracking;
    if (!provider || !timeTracking) {
      return undefined;
    }
    const pluginConfig = withPluginOAuthTokenKey(
      provider.pluginId,
      cfg.pluginConfig,
      cfg.id,
    );
    const http = this._pluginHttp.createHttpHelper(
      () => provider.definition.getHeaders(pluginConfig),
      { allowPrivateNetwork: provider.allowPrivateNetwork },
    );
    const providerName = this._registry.getHumanReadableName(cfg.issueProviderKey);
    return {
      cfg,
      definition: provider.definition,
      issueId,
      timeTracking,
      pluginConfig,
      http,
      providerName,
      icon: toPluginSvgIcon(provider.icon, provider.pluginId),
    };
  }

  private async _openDialog(task: Task, ctx: TimeTrackingCtx): Promise<void> {
    let issueLabel: string;
    let issueUrl: string | undefined;
    try {
      const issue = await ctx.definition.getById(ctx.issueId, ctx.pluginConfig, ctx.http);
      issueLabel = issue.title;
      issueUrl = issue.url;
    } catch (e) {
      this._showError(ctx, e);
      return;
    }
    try {
      const { DialogTrackTimeComponent } =
        await import('../../features/issue/shared/dialog-track-time/dialog-track-time.component');
      this._matDialog.open(DialogTrackTimeComponent, {
        restoreFocus: true,
        data: this._buildDialogData(task, ctx, { issueLabel, issueUrl }),
      });
    } catch (e) {
      // e.g. lazy chunk failed to load while offline; `void` caller would drop it
      this._showError(ctx, e);
    }
  }

  private _buildDialogData(
    task: Task,
    ctx: TimeTrackingCtx,
    issue: { issueLabel: string; issueUrl?: string },
  ): TrackTimeDialogData {
    const { timeTracking, pluginConfig, http, issueId } = ctx;
    const tr = (key: string): string =>
      this._translateService.instant(key, { providerName: ctx.providerName });
    return {
      task,
      issueIcon: ctx.icon,
      issueLabel: issue.issueLabel,
      issueUrl: issue.issueUrl,
      timeLogged: 0,
      timeLoggedUpdate$: timeTracking.getTimeLogged
        ? from(timeTracking.getTimeLogged(issueId, pluginConfig, http)).pipe(
            catchError(() => of(0)),
          )
        : undefined,
      activities$: timeTracking.getActivities
        ? from(timeTracking.getActivities(pluginConfig, http)).pipe(
            // the template's async pipe would throw on a rejected request
            catchError(() => of([])),
          )
        : undefined,
      defaultTime: pluginConfig['timeTrackingDialogDefaultTime'] as
        | JiraWorklogExportDefaultTime
        | undefined,
      configTimeKey: 'timeTrackingDialogDefaultTime',
      saveDefaultTime: (value) => this._saveDefaultTime(ctx.cfg.id, value),
      onSubmit: (params) =>
        from(
          timeTracking.logTime(
            issueId,
            {
              started: new Date(params.started).getTime(),
              timeSpentMs: params.timeSpent,
              comment: params.comment,
              activityId: params.activityId,
            },
            pluginConfig,
            http,
          ),
        ).pipe(
          catchError((e) => {
            // the dialog stays open on error but shows nothing itself
            this._showError(ctx, e);
            throw e;
          }),
        ),
      successMsg: T.F.ISSUE.S.POST_TIME_SUCCESS,
      successTranslateParams: {
        issueTitle: issue.issueLabel,
        providerName: ctx.providerName,
      },
      t: {
        title: tr(T.F.ISSUE.DIALOG_TRACK_TIME.TITLE),
        submitFor: tr(T.F.ISSUE.DIALOG_TRACK_TIME.SUBMIT_TIME_FOR),
        submit: T.F.ISSUE.DIALOG_TRACK_TIME.POST_TIME,
        timeSpent: T.F.ISSUE.DIALOG_TRACK_TIME.TIME_SPENT,
        timeSpentTooltip: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT_TOOLTIP,
        started: T.F.ISSUE.DIALOG_TRACK_TIME.STARTED,
        invalidDate: T.F.ISSUE.DIALOG_TRACK_TIME.INVALID_DATE,
        comment: T.G.COMMENT,
        activity: T.F.ISSUE.DIALOG_TRACK_TIME.ACTIVITY,
      },
    };
  }

  private async _saveDefaultTime(
    issueProviderId: string,
    value: JiraWorklogExportDefaultTime,
  ): Promise<void> {
    // re-read so a config edited while the dialog was open is not overwritten
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg) {
      return;
    }
    this._store.dispatch(
      IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id: issueProviderId,
          changes: {
            pluginConfig: { ...cfg.pluginConfig, timeTrackingDialogDefaultTime: value },
          },
        },
      }),
    );
  }

  private _getCfgOnce$(
    issueProviderId: string,
  ): Observable<IssueProviderPluginType | undefined> {
    return this._store.select(selectIssueProviderState).pipe(
      first(),
      map(({ entities }) => {
        const cfg = entities[issueProviderId] as IssueProviderPluginType | undefined;
        return cfg?.pluginId && cfg.pluginConfig ? cfg : undefined;
      }),
    );
  }

  private _showError(ctx: TimeTrackingCtx, e: unknown): void {
    this._snackService.open({
      type: 'ERROR',
      msg: T.F.ISSUE.S.ERR_GENERIC,
      translateParams: { issueProviderName: ctx.providerName, errTxt: getErrorTxt(e) },
    });
  }
}
