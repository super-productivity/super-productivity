import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, firstValueFrom, timer } from 'rxjs';
import { distinctUntilChanged, map, switchMap, timeout } from 'rxjs/operators';
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
const REQUEST_TIMEOUT = 15 * 1000;

// Strict (anchored) on purpose, unlike the lenient parser in is-newer-version.ts:
// the tag is remote input that ends up in a banner and in the release URL we
// open, so anything that isn't exactly a version tag is treated as malformed.
const RELEASE_TAG_REGEX = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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
  private _http = inject(HttpClient);
  private _globalConfigService = inject(GlobalConfigService);
  private _bannerService = inject(BannerService);
  private _snackService = inject(SnackService);

  private _isCheckInFlight = false;

  init(): void {
    if (!isUpdateCheckPossible()) {
      return;
    }
    this._globalConfigService.misc$
      .pipe(
        // Hydration merges defaults per-key (global-config.reducer loadAllData),
        // but the pre-hydration initial state and partial section updates can
        // still lack the key — treat missing as the default ON either way.
        map((misc) => misc?.isCheckForUpdates !== false),
        distinctUntilChanged(),
        switchMap((isEnabled) =>
          isEnabled ? timer(INITIAL_CHECK_DELAY, CHECK_INTERVAL) : EMPTY,
        ),
      )
      .subscribe(() => this.checkForUpdate());
  }

  async checkForUpdate({ isUserTriggered = false } = {}): Promise<void> {
    if (this._isCheckInFlight) {
      return;
    }
    this._isCheckInFlight = true;
    try {
      const release = await firstValueFrom(
        this._http
          .get<{ tag_name?: string }>(RELEASES_API_URL, {
            headers: { Accept: 'application/vnd.github+json' },
          })
          .pipe(timeout(REQUEST_TIMEOUT)),
      );
      const tagName = release.tag_name;
      if (!tagName || !RELEASE_TAG_REGEX.test(tagName)) {
        throw new Error('Malformed release data');
      }

      if (!isNewerVersion(tagName, environment.version)) {
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
        localStorage.getItem(LS.UPDATE_CHECK_DISMISSED_VERSION) === tagName
      ) {
        return;
      }
      this._showUpdateBanner(tagName);
    } catch (err) {
      // being offline is a normal state for the automatic check → info log only
      Log.log('Update check failed', { error: (err as Error)?.message });
      if (isUserTriggered) {
        this._snackService.open({ type: 'ERROR', msg: T.APP.UPDATE_CHECK.ERROR });
      }
    } finally {
      this._isCheckInFlight = false;
    }
  }

  private _showUpdateBanner(versionTag: string): void {
    // Built locally from the validated tag instead of trusting the response's
    // html_url: openExternalUrl only checks the scheme, so a forged response
    // could otherwise point "Download" at an arbitrary https host.
    const downloadUrl = `https://github.com/super-productivity/super-productivity/releases/tag/${versionTag}`;
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
