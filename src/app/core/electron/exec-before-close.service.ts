import { Injectable } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { IS_ELECTRON } from '../../app.constants';
import { ipcNotifyOnClose$ } from '../ipc-events';

export const getBeforeCloseIdsFromIpcEvent = (ipcEvent: unknown): string[] | null => {
  if (!Array.isArray(ipcEvent)) {
    return null;
  }

  const [, ids] = ipcEvent;
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : null;
};

@Injectable({ providedIn: 'root' })
export class ExecBeforeCloseService {
  onBeforeClose$: Observable<string[]> = IS_ELECTRON
    ? ipcNotifyOnClose$.pipe(
        map(getBeforeCloseIdsFromIpcEvent),
        filter((ids): ids is string[] => ids !== null),
      )
    : EMPTY;

  schedule(id: string): void {
    this._electronApi?.scheduleRegisterBeforeClose(id);
  }

  unschedule(id: string): void {
    this._electronApi?.unscheduleRegisterBeforeClose(id);
  }

  setDone(id: string): void {
    this._electronApi?.setDoneRegisterBeforeClose(id);
  }

  private get _electronApi(): typeof window.ea | undefined {
    return typeof window === 'undefined' ? undefined : window.ea;
  }
}
