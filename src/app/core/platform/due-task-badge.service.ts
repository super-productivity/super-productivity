import { inject, Injectable, InjectionToken } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { IS_ANDROID_NATIVE, IS_IOS_NATIVE } from '../../util/is-native-platform';
import { Log } from '../log';

export interface DueTaskBadgePlugin {
  setCount(options: { count: number }): Promise<void>;
}

export const DUE_TASK_BADGE_PLUGIN = new InjectionToken<DueTaskBadgePlugin | null>(
  'DUE_TASK_BADGE_PLUGIN',
  {
    providedIn: 'root',
    factory: () =>
      IS_IOS_NATIVE ? registerPlugin<DueTaskBadgePlugin>('DueTaskBadge') : null,
  },
);

/**
 * Writes the due-task count to the native app-icon badge.
 *
 * iOS uses a Capacitor plugin. Android (#11147) should add
 * `setDueTaskBadge(count)` on the SUPAndroid / JavaScriptInterface bridge and
 * call it from here — optional chaining keeps older APKs safe until then.
 */
@Injectable({ providedIn: 'root' })
export class DueTaskBadgeService {
  private readonly _plugin = inject(DUE_TASK_BADGE_PLUGIN);

  async setCount(count: number): Promise<void> {
    const safe = Math.max(0, Math.floor(count));
    if (this._plugin) {
      try {
        await this._plugin.setCount({ count: safe });
      } catch (e) {
        Log.warn('DueTaskBadgeService: setCount failed', e);
      }
      return;
    }

    // #11147 — call when JavaScriptInterface.setDueTaskBadge exists; no-op today.
    if (IS_ANDROID_NATIVE) {
      (
        window as Window & {
          SUPAndroid?: { setDueTaskBadge?(n: number): void };
        }
      ).SUPAndroid?.setDueTaskBadge?.(safe);
    }
  }
}
