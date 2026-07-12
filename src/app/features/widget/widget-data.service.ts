import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../android/android-interface';
import { WidgetBridge } from './widget-bridge';
import { WIDGET_DATA_KEY } from './widget-data.model';
import { selectWidgetData } from './store/widget.selectors';
import { Log } from '../../core/log';

/**
 * Pushes the current today-task snapshot to the native store backing the home
 * screen widget (Android: KeyValStore via androidInterface; iOS: App Group
 * UserDefaults via the WidgetBridge Capacitor plugin). Dedupes against the
 * last successfully pushed blob so every trigger path (state change, pause,
 * post-sync) can call it unconditionally.
 */
@Injectable({ providedIn: 'root' })
export class WidgetDataService {
  private _store = inject(Store);
  private _lastPushedJson: string | null = null;

  async pushCurrent(): Promise<void> {
    const data = await firstValueFrom(this._store.select(selectWidgetData));
    const json = JSON.stringify(data);
    if (json === this._lastPushedJson) {
      return;
    }
    try {
      if (IS_ANDROID_WEB_VIEW) {
        await androidInterface.saveToDbWrapped(WIDGET_DATA_KEY, json);
        androidInterface.updateWidget?.();
      } else {
        await WidgetBridge.setWidgetData({ json });
      }
      // only remember successful pushes, so a failed one is retried next trigger
      this._lastPushedJson = json;
    } catch (e) {
      Log.err('Failed to push widget data', e);
    }
  }

  /**
   * Read and clear the pending widget done-tap queue. Both platforms return
   * the same JSON object string `{taskId: targetIsDone}`, or null when empty.
   */
  async getAndClearDoneQueue(): Promise<string | null> {
    if (IS_ANDROID_WEB_VIEW) {
      return androidInterface.getWidgetDoneQueue?.() ?? null;
    }
    return (await WidgetBridge.getAndClearDoneQueue()).json;
  }
}
