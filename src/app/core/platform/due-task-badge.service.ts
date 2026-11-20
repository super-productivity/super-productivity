import { inject, Injectable, InjectionToken } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { IS_IOS_NATIVE } from '../../util/is-native-platform';
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

/** Writes the due-task count to the native iOS app-icon badge. */
@Injectable({ providedIn: 'root' })
export class DueTaskBadgeService {
  private readonly _plugin = inject(DUE_TASK_BADGE_PLUGIN);

  async setCount(count: number): Promise<void> {
    if (!this._plugin) return;
    try {
      await this._plugin.setCount({ count: Math.max(0, Math.floor(count)) });
    } catch (e) {
      Log.warn('DueTaskBadgeService: setCount failed', e);
    }
  }
}
