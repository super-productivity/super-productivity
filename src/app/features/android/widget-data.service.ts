import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { androidInterface } from './android-interface';
import { ANDROID_WIDGET_DATA_KEY } from './android-widget.model';
import { selectAndroidWidgetData } from './store/android-widget.selectors';
import { DroidLog } from '../../core/log';

/**
 * Pushes the current today-task snapshot to the native KeyValStore for the home
 * screen widget. Dedupes against the last successfully pushed blob so every
 * trigger path (state change, pause, post-sync) can call it unconditionally.
 */
@Injectable({ providedIn: 'root' })
export class WidgetDataService {
  private _store = inject(Store);
  private _lastPushedJson: string | null = null;

  async pushCurrent(): Promise<void> {
    const data = await firstValueFrom(this._store.select(selectAndroidWidgetData));
    const json = JSON.stringify(data);
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
