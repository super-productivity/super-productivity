import { inject, Injectable } from '@angular/core';
import { EMPTY, timer } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { T } from '../../t.const';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { isNewerVersion } from '../../util/is-newer-version';
import { BannerService } from '../banner/banner.service';
import { BannerId } from '../banner/banner.model';
import { SnackService } from '../snack/snack.service';
import { LS } from '../persistence/storage-keys.const';
import { Log } from '../log';
import { isUpdateCheckPossible } from './is-update-check-possible.util';

const RELEASES_API_URL =
  'https://api.github.com/repos/super-productivity/super-productivity/releases/latest';
const INITIAL_CHECK_DELAY = 30 * 1000;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * Desktop-only "new version available" check (#5463). Fetches the latest
 * published GitHub release and shows a once-per-version banner linking to the
 * release page — deliberately no auto-download/install, since the desktop
 * builds ship through too many package formats for one install path.
 *
 * Privacy: a bare unauthenticated GET with no identifiers or user data; the
 * automatic check can be disabled via `misc.isCheckForUpdates` and is skipped
 * entirely on self-updating channels (see is-update-check-possible.util.ts).
 */
@Injectable({ providedIn: 'root' })
export class UpdateCheckService {
  private _globalConfigService = inject(GlobalConfigService);
  private _bannerService = inject(BannerService);
  private _snackService = inject(SnackService);

  init(): void {
    if (!isUpdateCheckPossible()) {
      return;
    }
    this._globalConfigService.misc$
      .pipe(
        // missing key (pre-feature persisted config) means default ON
        map((misc) => misc?.isCheckForUpdates !== false),
        distinctUntilChanged(),
        switchMap((isEnabled) =>
          isEnabled ? timer(INITIAL_CHECK_DELAY, CHECK_INTERVAL) : EMPTY,
        ),
      )
      .subscribe(() => this.checkForUpdate());
  }

  async checkForUpdate({ isUserTriggered = false } = {}): Promise<void> {
    try {
      const res = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) {
        throw new Error(`Unexpected response ${res.status}`);
      }
      const release: { tag_name?: string; html_url?: string } = await res.json();
      if (!release.tag_name || !release.html_url) {
        throw new Error('Malformed release data');
      }

      if (!isNewerVersion(release.tag_name, environment.version)) {
        if (isUserTriggered) {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.APP.UPDATE_CHECK.UP_TO_DATE,
            translateParams: { version: environment.version },
          });
        }
        return;
      }
      if (
        !isUserTriggered &&
        localStorage.getItem(LS.UPDATE_CHECK_DISMISSED_VERSION) === release.tag_name
      ) {
        return;
      }
      this._showUpdateBanner(release.tag_name, release.html_url);
    } catch (err) {
      // being offline is a normal state for the automatic check → info log only
      Log.log('Update check failed', { error: (err as Error)?.message });
      if (isUserTriggered) {
        this._snackService.open({ type: 'ERROR', msg: T.APP.UPDATE_CHECK.ERROR });
      }
    }
  }

  private _showUpdateBanner(versionTag: string, downloadUrl: string): void {
    this._bannerService.open({
      id: BannerId.UpdateAvailable,
      msg: T.APP.B_UPDATE_AVAILABLE.MSG,
      translateParams: { version: versionTag },
      ico: 'file_download',
      // the plain X would not persist the dismissal → the banner would nag
      // again on the next check; both explicit actions below do persist
      isHideDismissBtn: true,
      action: {
        label: T.APP.B_UPDATE_AVAILABLE.DOWNLOAD,
        fn: () => {
          this._rememberVersion(versionTag);
          window.ea.openExternalUrl(downloadUrl);
        },
      },
      action2: {
        label: T.G.DISMISS,
        fn: () => this._rememberVersion(versionTag),
      },
    });
  }

  private _rememberVersion(versionTag: string): void {
    localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, versionTag);
  }
}
