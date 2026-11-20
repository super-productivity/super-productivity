import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import { IS_ELECTRON } from '../../../app.constants';
import { SyncLog } from '../../../core/log';
import {
  getCurrentPlatformCode,
  PlatformCode,
} from '../../../core/util/generate-client-id';
import { getOsLabel } from '../../../core/util/get-os-label';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { SyncConfig } from '../../../features/config/global-config.model';
import { getDeviceLabel } from '../../../features/tracking-presence/get-device-label.util';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { isOnline } from '../../../util/is-online';
import { IS_IOS_NATIVE, IS_NATIVE_PLATFORM } from '../../../util/is-native-platform';
import { SyncConfigService } from '../sync-config.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { SuperSyncFinishService } from './super-sync-finish.service';
import {
  ConnectPlatform,
  ConnectRequest,
  createConnectRequest,
  pollConnectRequest,
  SignInOutcome,
  waitForApproval,
} from './super-sync-connect.api';

/** The server's platform list, from the same platform code the client id uses. */
export const getConnectPlatform = (
  code: PlatformCode = getCurrentPlatformCode(),
  userAgent: string = navigator.userAgent,
): ConnectPlatform => {
  if (code === 'A') return 'android';
  if (code === 'I') return 'ios';
  if (code === 'B') return 'web';
  const os = getOsLabel(userAgent);
  return os === 'macOS' ? 'mac' : os === 'Windows' ? 'windows' : 'linux';
};

/**
 * `https://host/` → `https://host`; null unless http or https. Empty means the
 * default server.
 */
export const normalizeSuperSyncBaseUrl = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return defaultBaseUrl();
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? trimmed.replace(/\/+$/, '')
      : null;
  } catch {
    return null;
  }
};

// The form's default too: the official server, or the local one in dev builds
// and E2E runs.
const defaultBaseUrl = (): string =>
  (DEFAULT_GLOBAL_CONFIG.sync.superSync?.baseUrl ?? '').replace(/\/+$/, '');

/**
 * Signs this device in to SuperSync through the browser. The dialog owns the
 * steps; this service talks to the server, opens the browser and saves the
 * account token the way the settings dialog's Save does.
 */
@Injectable({ providedIn: 'root' })
export class SuperSyncConnectService {
  private _syncConfigService = inject(SyncConfigService);
  private _syncWrapperService = inject(SyncWrapperService);
  private _providerManager = inject(SyncProviderManager);
  private _finish = inject(SuperSyncFinishService);

  /** The server saved for SuperSync on this device, else the default. */
  async savedBaseUrl(): Promise<string> {
    const provider = await this._providerManager.getProviderById(
      SyncProviderId.SuperSync,
    );
    const cfg = (await provider?.privateCfg.load()) as SuperSyncPrivateCfg | null;
    return normalizeSuperSyncBaseUrl(cfg?.baseUrl ?? '') ?? defaultBaseUrl();
  }

  start(baseUrl: string): Promise<ConnectRequest> {
    return createConnectRequest(baseUrl, {
      deviceName: getDeviceLabel(),
      platform: getConnectPlatform(),
    });
  }

  waitForApproval(
    baseUrl: string,
    request: ConnectRequest,
    isCancelled: () => boolean,
  ): Promise<SignInOutcome> {
    return waitForApproval(request.pollIntervalMs, {
      poll: () => pollConnectRequest(baseUrl, request),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      isCancelled,
    });
  }

  /**
   * Web only: a tab opened after an `await` counts as a popup and gets blocked
   * (Safari), so the click opens it empty and `openInBrowser` fills it later.
   */
  openBlankTab(): Window | null {
    if (IS_ELECTRON || IS_NATIVE_PLATFORM) return null;
    const tab = window.open('', '_blank');
    // The server page must not be able to navigate the app's tab.
    if (tab) tab.opener = null;
    return tab;
  }

  openInBrowser(url: string, blankTab: Window | null = null): void {
    if (IS_ELECTRON) {
      window.ea.openExternalUrl(url);
    } else if (IS_NATIVE_PLATFORM) {
      import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url }))
        .catch((e) => SyncLog.err('Opening the browser failed', { name: e?.name }));
    } else if (blankTab && !blankTab.closed) {
      blankTab.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  /** After the browser approved: back to the app window. */
  returnToApp(): void {
    if (IS_ELECTRON) {
      window.ea.showOrFocus();
    } else if (IS_IOS_NATIVE) {
      // iOS shows the page in a sheet over the app; Android's custom tab is
      // a separate screen the user leaves with Back.
      import('@capacitor/browser')
        .then(({ Browser }) => Browser.close())
        .catch((e) => SyncLog.warn('Closing the browser failed', { name: e?.name }));
    }
  }

  /**
   * Saves the account token and starts the first sync. The same steps the
   * settings dialog's Save takes for a first SuperSync setup
   * (`DialogSyncCfgComponent.save`).
   */
  async applyToken(accessToken: string, baseUrl: string): Promise<void> {
    const current = await firstValueFrom(this._syncConfigService.syncSettingsForm$);
    const settings: SyncConfig = {
      ...current,
      isEnabled: true,
      syncProvider: SyncProviderId.SuperSync,
      superSync: { ...current.superSync, accessToken, baseUrl },
    };
    await this._syncConfigService.updateSettingsFromForm(settings, true);
    // Armed before the online check: an offline device asks for the encryption
    // password when its first sync finally runs.
    this._syncWrapperService.markPromptEncryptionAfterSetupSync();
    this._finish.arm();
    if (isOnline()) {
      void this._syncWrapperService.sync(true);
    }
  }
}
