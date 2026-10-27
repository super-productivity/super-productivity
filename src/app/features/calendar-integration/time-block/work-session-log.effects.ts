import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect } from '@ngrx/effects';
import { EMPTY, Observable, from } from 'rxjs';
import { catchError, concatMap, filter, first, map, scan } from 'rxjs/operators';
import { PluginWorkSession } from '@super-productivity/plugin-api';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { SnackService } from '../../../core/snack/snack.service';
import { getErrorTxt } from '../../../util/get-error-text';
import { T } from '../../../t.const';
import { Log } from '../../../core/log';
import { createTimeBlockContext } from './time-block-context';
import {
  INITIAL_WORK_SESSION_STEP,
  MIN_WORK_SESSION_MS,
  stepWorkSession,
} from './work-session.util';

/**
 * Writes each finished time-tracking session as a calendar event (#6378), through
 * the first calendar plugin whose `isLogWorkSessions` option is on.
 *
 * The current task is device-local state (no op, never synced), so only the device
 * that tracked the time writes the event and remote replays cannot create duplicates.
 * Remote ops can still end a local session (e.g. the task is deleted elsewhere),
 * which is a real end, so this selector-based effect deliberately has no sync guard;
 * it never dispatches.
 *
 * shortcut: a session that ends while the app is closed, or whose write fails, is
 * not logged — persist pending sessions and retry if users report gaps.
 */
@Injectable()
export class WorkSessionLogEffects {
  private readonly _store = inject(Store);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttpService = inject(PluginHttpService);
  private readonly _snackService = inject(SnackService);

  logWorkSessions$: Observable<unknown> = createEffect(
    () =>
      this._store.select(selectCurrentTask).pipe(
        scan(
          (step, task) => stepWorkSession(step, task, Date.now()),
          INITIAL_WORK_SESSION_STEP,
        ),
        map((step) => step.ended),
        filter(
          (session): session is PluginWorkSession =>
            !!session && session.end - session.start >= MIN_WORK_SESSION_MS,
        ),
        concatMap((session) => this._logWorkSession$(session)),
      ),
    { dispatch: false },
  );

  private _logWorkSession$(session: PluginWorkSession): Observable<unknown> {
    return this._store.select(selectEnabledIssueProviders).pipe(
      first(),
      concatMap((providers) => {
        const ctx = createTimeBlockContext({
          providers,
          configKey: 'isLogWorkSessions',
          registry: this._pluginRegistry,
          httpService: this._pluginHttpService,
        });
        const timeBlock = ctx?.definition.timeBlock;
        if (!ctx || !timeBlock?.logWorkSession) return EMPTY;
        return from(timeBlock.logWorkSession(session, ctx.config, ctx.http));
      }),
      catchError((err) => {
        Log.err('[WorkSessionLog] Failed to log work session', {
          taskId: session.taskId,
          err,
        });
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.CALENDARS.S.WORK_SESSION_ERROR,
          translateParams: { errTxt: getErrorTxt(err) },
        });
        return EMPTY;
      }),
    );
  }
}
