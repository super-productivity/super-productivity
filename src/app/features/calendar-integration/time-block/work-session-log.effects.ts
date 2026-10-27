import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect } from '@ngrx/effects';
import { EMPTY, Observable, from, merge, timer } from 'rxjs';
import {
  catchError,
  concatMap,
  distinctUntilChanged,
  filter,
  finalize,
  first,
  map,
  mergeMap,
  scan,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { PluginWorkSession } from '@super-productivity/plugin-api';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ExecBeforeCloseService } from '../../../core/electron/exec-before-close.service';
import { IS_ELECTRON } from '../../../app.constants';
import { IssueProviderPluginType, isPluginIssueProvider } from '../../issue/issue.model';
import { getErrorTxt } from '../../../util/get-error-text';
import { T } from '../../../t.const';
import { Log } from '../../../core/log';
import { createTimeBlockContext } from './time-block-context';
import {
  INITIAL_WORK_SESSION_STEP,
  MIN_WORK_SESSION_MS,
  WorkSessionStep,
  stepWorkSession,
} from './work-session.util';

export const WORK_SESSION_BEFORE_CLOSE_ID = 'WORK_SESSION_LOG_BEFORE_CLOSE';
/** How long quitting the desktop app may wait for the last session's write. */
const MAX_CLOSE_WAIT_MS = 5000;
const CLOSE = 'CLOSE' as const;

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
 * Quitting the desktop app ends the running session; the quit waits (briefly) for
 * its write.
 *
 * shortcut: a session cut short by a crash, a closed browser tab or a killed mobile
 * app, or whose write fails, is not logged — persist pending sessions and retry if
 * users report gaps.
 */
@Injectable()
export class WorkSessionLogEffects {
  private readonly _store = inject(Store);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttpService = inject(PluginHttpService);
  private readonly _snackService = inject(SnackService);
  private readonly _execBeforeCloseService = inject(ExecBeforeCloseService);

  /** Makes the desktop app wait for this effect on quit while the option is on. */
  scheduleBeforeClose$ =
    IS_ELECTRON &&
    createEffect(
      () =>
        this._store.select(selectEnabledIssueProviders).pipe(
          map((providers) =>
            providers.some(
              (p) =>
                isPluginIssueProvider(p.issueProviderKey) &&
                !!(p as IssueProviderPluginType).pluginConfig?.isLogWorkSessions,
            ),
          ),
          distinctUntilChanged(),
          tap((isOn) =>
            isOn
              ? this._execBeforeCloseService.schedule(WORK_SESSION_BEFORE_CLOSE_ID)
              : this._execBeforeCloseService.unschedule(WORK_SESSION_BEFORE_CLOSE_ID),
          ),
        ),
      { dispatch: false },
    );

  logWorkSessions$: Observable<unknown> = createEffect(
    () =>
      merge(
        this._store.select(selectCurrentTask),
        this._execBeforeCloseService.onBeforeClose$.pipe(
          filter((ids) => ids.includes(WORK_SESSION_BEFORE_CLOSE_ID)),
          map(() => CLOSE),
        ),
      ).pipe(
        scan(
          (step: WorkSessionStep & { isClose: boolean }, event) => {
            const task = event === CLOSE ? null : event;
            return {
              ...stepWorkSession(step, task, Date.now()),
              isClose: event === CLOSE,
            };
          },
          { ...INITIAL_WORK_SESSION_STEP, isClose: false },
        ),
        // Writes are independent PUTs, so they may overlap; that keeps a quit from
        // queueing behind an earlier, slow write.
        mergeMap(({ ended, isClose }) => {
          const log$ =
            ended && ended.end - ended.start >= MIN_WORK_SESSION_MS
              ? this._logWorkSession$(ended)
              : EMPTY;
          return isClose
            ? log$.pipe(
                takeUntil(timer(MAX_CLOSE_WAIT_MS)),
                finalize(() =>
                  this._execBeforeCloseService.setDone(WORK_SESSION_BEFORE_CLOSE_ID),
                ),
              )
            : log$;
        }),
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
