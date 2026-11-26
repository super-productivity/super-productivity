import { EMPTY, fromEvent, merge, Observable } from 'rxjs';
import { filter, throttleTime } from 'rxjs/operators';
import { ipcResume$ } from '../../../core/ipc-events';
import { IssueProvider } from '../issue.model';
import { PLAINSPACE_TYPE } from '../issue.const';

/** At most one extra poll per provider per minute from looking at the app. */
export const REFRESH_ON_LOOK_THROTTLE_MS = 60 * 1000;

/**
 * Plainspace is where other people change shared tasks, so its full poll also
 * runs when I come back to the app — window focus, the app becoming visible
 * (also a mobile app resume) or Electron waking from sleep — instead of only
 * every few minutes. Other providers keep their interval only. No delta
 * polling: each trigger is the same full poll as the timer's.
 */
export const getRefreshOnLook$ = (provider: IssueProvider): Observable<unknown> =>
  provider.issueProviderKey === PLAINSPACE_TYPE
    ? merge(
        fromEvent(window, 'focus'),
        fromEvent(document, 'visibilitychange').pipe(
          filter(() => document.visibilityState === 'visible'),
        ),
        // EMPTY outside Electron.
        ipcResume$,
      ).pipe(throttleTime(REFRESH_ON_LOOK_THROTTLE_MS))
    : EMPTY;
