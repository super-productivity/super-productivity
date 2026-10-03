import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { androidInterface } from './android-interface';
import { ANDROID_WIDGET_DATA_KEY, AndroidWidgetData } from './android-widget.model';
import {
  resolveRemoteCurrentTask,
  selectAndroidWidgetData,
} from './store/android-widget.selectors';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { TrackingPresenceService } from '../tracking-presence/tracking-presence.service';
import { DroidLog } from '../../core/log';

/**
 * Pushes the current today-task snapshot to the native KeyValStore for the home
 * screen widget. Dedupes against the last successfully pushed blob so every
 * trigger path (state change, pause, post-sync) can call it unconditionally.
 */
@Injectable({ providedIn: 'root' })
export class WidgetDataService {
  private _store = inject(Store);
  private _trackingPresence = inject(TrackingPresenceService);
  private _lastPushedJson: string | null = null;

  async pushCurrent(): Promise<void> {
    const data = await firstValueFrom(this._store.select(selectAndroidWidgetData));
    // The selector only knows about local tracking; when nothing is tracked here,
    // fall back to the last-known remote tracking-presence session (SuperSync
    // only) so the widget can still say "tracking on <device>".
    let currentTask = data.currentTask;
    if (!currentTask) {
      const taskEntities = await firstValueFrom(this._store.select(selectTaskEntities));
      currentTask = resolveRemoteCurrentTask(
        this._trackingPresence.remoteSessionView(),
        taskEntities,
      );
    }
    const payload: AndroidWidgetData = { ...data, currentTask };
    const json = JSON.stringify(payload);
    // Compare the WHOLE blob, not just the tasks: at day rollover the list is often
    // byte-identical and only the staleness stamp moves, and that push is the single
    // thing that un-outdates the widget. Narrowing this key would silently restore
    // #9098. (Not unit-tested — androidInterface is a module-level window capture, so
    // this method is unreachable from Karma; see android-widget.effects.ts for the
    // codebase's export-the-pure-logic pattern.)
    if (json === this._lastPushedJson) {
      return;
    }
    try {
      await androidInterface.saveToDbWrapped(ANDROID_WIDGET_DATA_KEY, json);
      androidInterface.updateWidget?.();
      // only remember successful pushes, so a failed one is retried next trigger
      this._lastPushedJson = json;
    } catch (e) {
      DroidLog.err('Failed to push widget data', e);
    }
  }
}
