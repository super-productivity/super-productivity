import { Injectable } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { IS_ELECTRON } from '../../app.constants';
import { ipcNotifyOnClose$ } from '../ipc-events';

@Injectable({ providedIn: 'root' })
export class ExecBeforeCloseService {
  onBeforeClose$: Observable<string[]> = IS_ELECTRON ? ipcNotifyOnClose$ : EMPTY;

  constructor() {}

  schedule(id: string): void {
    window.ea.scheduleRegisterBeforeClose(id);
  }

  unschedule(id: string): void {
    window.ea.unscheduleRegisterBeforeClose(id);
  }

  setDone(id: string): void {
    window.ea.setDoneRegisterBeforeClose(id);
  }
}
