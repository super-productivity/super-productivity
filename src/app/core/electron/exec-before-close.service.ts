import { DestroyRef, inject, Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PluginBeforeCloseHandler } from '@super-productivity/plugin-api';
import { IS_ELECTRON } from '../../app.constants';
import { ipcNotifyOnClose$ } from '../ipc-events';
import { BeforeCloseCoordinator } from './before-close-coordinator';
import { PluginLog } from '../log';

@Injectable({ providedIn: 'root' })
export class ExecBeforeCloseService {
  private readonly _requests = new Subject<string[]>();
  readonly onBeforeClose$ = this._requests.asObservable();
  private readonly _coordinator = new BeforeCloseCoordinator(
    {
      schedule: (id) => this.schedule(id),
      unschedule: (id) => this.unschedule(id),
      done: (id) => window.ea.setDoneRegisterBeforeClose(id),
    },
    () => PluginLog.err('Plugin before-close callback failed'),
  );

  constructor() {
    if (IS_ELECTRON) {
      ipcNotifyOnClose$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((ids) => {
        this._coordinator.request(ids, (ordinaryIds) => this._requests.next(ordinaryIds));
      });
    }
  }

  registerPluginFinalizer(
    pluginId: string,
    owner: string,
    callback: PluginBeforeCloseHandler | null,
  ): boolean {
    if (!IS_ELECTRON) return false;
    this._coordinator.register(`${pluginId}\0${owner}`, callback);
    return true;
  }

  unregisterPluginFinalizers(pluginId: string): void {
    this._coordinator.unregisterPlugin(pluginId);
  }

  cancelCloseAttempt(): void {
    this._coordinator.cancelCloseAttempt();
  }

  schedule(id: string): void {
    window.ea.scheduleRegisterBeforeClose(id);
  }

  unschedule(id: string): void {
    window.ea.unscheduleRegisterBeforeClose(id);
    this._coordinator.unscheduled(id);
  }

  setDone(id: string): void {
    this._coordinator.done(id);
  }
}
