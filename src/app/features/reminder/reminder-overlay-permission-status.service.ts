import { inject, Injectable, InjectionToken } from '@angular/core';
import { EMPTY, merge, Observable, of } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import {
  IS_ANDROID_WEB_VIEW,
  IS_ANDROID_WEB_VIEW_TOKEN,
} from '../../util/is-android-web-view';
import { androidInterface } from '../android/android-interface';

export interface ReminderOverlayPermissionBridge {
  canDrawOverlays(): boolean;
  openSettings(): void;
}

export const REMINDER_OVERLAY_PERMISSION_BRIDGE =
  new InjectionToken<ReminderOverlayPermissionBridge>(
    'REMINDER_OVERLAY_PERMISSION_BRIDGE',
    {
      providedIn: 'root',
      factory: () => ({
        canDrawOverlays: () => androidInterface?.canDrawReminderOverlays?.() ?? true,
        openSettings: () => androidInterface?.openReminderOverlaySettings?.(),
      }),
    },
  );

export const REMINDER_OVERLAY_RECHECK_ON_RESUME = new InjectionToken<Observable<unknown>>(
  'REMINDER_OVERLAY_RECHECK_ON_RESUME',
  {
    providedIn: 'root',
    factory: () => (IS_ANDROID_WEB_VIEW ? androidInterface.onResume$ : EMPTY),
  },
);

@Injectable({ providedIn: 'root' })
export class ReminderOverlayPermissionStatusService {
  private _isAndroidWebView = inject(IS_ANDROID_WEB_VIEW_TOKEN);
  private _bridge = inject(REMINDER_OVERLAY_PERMISSION_BRIDGE);
  private _resume$ = inject(REMINDER_OVERLAY_RECHECK_ON_RESUME);

  readonly isDenied$: Observable<boolean> = merge(of(undefined), this._resume$).pipe(
    map(() => this._isAndroidWebView && !this._bridge.canDrawOverlays()),
    distinctUntilChanged(),
  );

  openSettings(): void {
    if (this._isAndroidWebView) {
      this._bridge.openSettings();
    }
  }
}
