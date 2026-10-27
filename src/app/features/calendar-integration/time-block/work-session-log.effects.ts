import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect } from '@ngrx/effects';
import { Observable, combineLatest, defer, from, merge } from 'rxjs';
import {
  concatMap,
  distinctUntilChanged,
  filter,
  first,
  map,
  scan,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { SnackService } from '../../../core/snack/snack.service';
import { LS } from '../../../core/persistence/storage-keys.const';
import { lsGetJSON } from '../../../util/ls-util';
import {
  IssueProvider,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../../issue/issue.model';
import { getErrorTxt } from '../../../util/get-error-text';
import { T } from '../../../t.const';
import { Log } from '../../../core/log';
import { TimeBlockContext, createTimeBlockContext } from './time-block-context';
import {
  INITIAL_WORK_SESSION_STEP,
  StoredWorkSessions,
  recordWorkSessionStep,
  recoverInterruptedWorkSession,
  removePendingWorkSession,
  stepWorkSession,
} from './work-session.util';

const CONFIG_KEY = 'isLogWorkSessions';

const loadStored = (): StoredWorkSessions => {
  const stored = lsGetJSON<Partial<StoredWorkSessions> | null>(LS.WORK_SESSION_LOG, null);
  return {
    open: stored?.open ?? null,
    pending: Array.isArray(stored?.pending) ? stored.pending : [],
  };
};

const saveStored = (stored: StoredWorkSessions): void => {
  const json = JSON.stringify(stored);
  // Skip no-op writes; the current task emits on every tracking tick.
  if (json !== localStorage.getItem(LS.WORK_SESSION_LOG)) {
    localStorage.setItem(LS.WORK_SESSION_LOG, json);
  }
};

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
 * The running session and unwritten ones are kept in device-local storage, so a
 * session cut short by a quit, crash or closed tab is written at the next start,
 * and a failed write is retried with the next session or the next start.
 */
@Injectable()
export class WorkSessionLogEffects {
  private readonly _store = inject(Store);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttpService = inject(PluginHttpService);
  private readonly _snackService = inject(SnackService);
  /** One warning per failure streak; every session end retries while offline. */
  private _isFailing = false;

  logWorkSessions$: Observable<unknown> = createEffect(
    () =>
      defer(() => {
        saveStored(recoverInterruptedWorkSession(loadStored(), Date.now()));
        const providers$ = this._store.select(selectEnabledIssueProviders);

        const sessionEnded$ = this._store.select(selectCurrentTask).pipe(
          scan(
            (step, task) => stepWorkSession(step, task, Date.now()),
            INITIAL_WORK_SESSION_STEP,
          ),
          withLatestFrom(providers$),
          tap(([step, providers]) =>
            saveStored(
              recordWorkSessionStep(
                loadStored(),
                this._isOn(providers) ? step : INITIAL_WORK_SESSION_STEP,
              ),
            ),
          ),
          filter(([step]) => !!step.ended),
        );
        // Plugins register after startup; write what is pending once one can.
        const canWrite$ = combineLatest([
          providers$,
          this._pluginRegistry.registrationChanges$,
        ]).pipe(
          map(([providers]) => !!this._createContext(providers)),
          distinctUntilChanged(),
          filter(Boolean),
        );
        return merge(canWrite$, sessionEnded$).pipe(
          concatMap(() => this._writePending$()),
        );
      }),
    { dispatch: false },
  );

  private _isOn(providers: IssueProvider[]): boolean {
    return providers.some(
      (p) =>
        isPluginIssueProvider(p.issueProviderKey) &&
        !!(p as IssueProviderPluginType).pluginConfig?.[CONFIG_KEY],
    );
  }

  private _createContext(providers: IssueProvider[]): TimeBlockContext | null {
    const ctx = createTimeBlockContext({
      providers,
      configKey: CONFIG_KEY,
      registry: this._pluginRegistry,
      httpService: this._pluginHttpService,
    });
    return ctx?.definition.timeBlock?.logWorkSession ? ctx : null;
  }

  private _writePending$(): Observable<unknown> {
    return this._store.select(selectEnabledIssueProviders).pipe(
      first(),
      concatMap((providers) => from(this._writePending(providers))),
    );
  }

  /** Writes pending sessions oldest first, stopping at the first failure. */
  private async _writePending(providers: IssueProvider[]): Promise<void> {
    const ctx = this._createContext(providers);
    const timeBlock = ctx?.definition.timeBlock;
    if (!ctx || !timeBlock?.logWorkSession) return;
    for (const session of loadStored().pending) {
      try {
        await timeBlock.logWorkSession(session, ctx.config, ctx.http);
      } catch (err) {
        Log.err('[WorkSessionLog] Failed to log work session', {
          taskId: session.taskId,
          err,
        });
        if (!this._isFailing) {
          this._isFailing = true;
          this._snackService.open({
            type: 'ERROR',
            msg: T.F.CALENDARS.S.WORK_SESSION_ERROR,
            translateParams: { errTxt: getErrorTxt(err) },
          });
        }
        return;
      }
      this._isFailing = false;
      saveStored(removePendingWorkSession(loadStored(), session));
    }
  }
}
