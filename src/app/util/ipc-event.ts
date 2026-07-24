import { Observable, ReplaySubject, Subject } from 'rxjs';
import { IS_ELECTRON } from '../app.constants';
import { devError } from './dev-error';
import { Log } from '../core/log';

const handlerMap: { [key: string]: Observable<unknown[]> } = {};

export const ipcEvent$ = (evName: string): Observable<unknown[]> => {
  if (!IS_ELECTRON) {
    devError(`ipcEvent$[${evName}] Not possible outside electron context`);
  }

  const subject = new Subject<unknown[]>();
  if (handlerMap[evName]) {
    Log.log(handlerMap);
    devError(`ipcEvent$[${evName}] should only ever be registered once`);
    return handlerMap[evName];
  }
  handlerMap[evName] = subject;

  const handler: (...args: unknown[]) => void = (...args): void => {
    Log.log('ipcEvent$ trigger', evName);
    subject.next([...args]);
  };

  if (!window.ea) {
    Log.err('window.ea is not available. Make sure the preload script is loaded.');
    return subject;
  }

  window.ea.on(evName, handler);

  return subject;
  // return subject.pipe(
  //   // finalize(() => {
  //   //   Log.log('FINALIZE', evName);
  //   //   // NOTE doesn't work due to the different contexts
  //   //   // window.ea.off(evName, handler);
  //   //   devError(`ipcEvent$[${evName}] observables live forever`);
  //   // }),
  // );
};

const replayHandlerMap: { [key: string]: Observable<unknown[]> } = {};

/**
 * Same as {@link ipcEvent$}, but backed by a `ReplaySubject(1)` instead of a
 * plain `Subject`, so a message sent before anything has subscribed (e.g. a
 * cold-launch IPC message racing Angular bootstrap) is still delivered to
 * the first subscriber rather than silently dropped. Use only for channels
 * where replaying the last value to a late subscriber is correct — most
 * `ipcEvent$` channels are fired repeatedly and should NOT replay stale data.
 *
 * Never consume one of these from an `@ngrx/effects` effect. NgRx's default
 * effects error handler re-subscribes a failing effect on error (up to
 * `MAX_NUMBER_OF_RETRY_ATTEMPTS` times), and re-subscribing to a
 * `ReplaySubject` replays its buffered value again, so a single IPC message
 * can produce multiple downstream actions/side effects instead of one. A
 * plain `Subject` (via `ipcEvent$`) doesn't have this problem since it has
 * nothing to replay.
 */
export const ipcEventReplay$ = (evName: string): Observable<unknown[]> => {
  if (!IS_ELECTRON) {
    devError(`ipcEventReplay$[${evName}] Not possible outside electron context`);
  }

  const subject = new ReplaySubject<unknown[]>(1);
  if (replayHandlerMap[evName]) {
    Log.log(replayHandlerMap);
    devError(`ipcEventReplay$[${evName}] should only ever be registered once`);
    return replayHandlerMap[evName];
  }
  replayHandlerMap[evName] = subject;

  const handler: (...args: unknown[]) => void = (...args): void => {
    Log.log('ipcEventReplay$ trigger', evName);
    subject.next([...args]);
  };

  if (!window.ea) {
    Log.err('window.ea is not available. Make sure the preload script is loaded.');
    return subject;
  }

  window.ea.on(evName, handler);

  return subject;
};
