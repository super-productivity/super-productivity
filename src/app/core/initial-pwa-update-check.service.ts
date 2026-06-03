import { Injectable, inject } from '@angular/core';
import { IS_ELECTRON } from '../app.constants';
import { defer, EMPTY, from, Observable, of } from 'rxjs';
import { catchError, concatMap, shareReplay, timeout } from 'rxjs/operators';
import { T } from '../t.const';
import { SwUpdate } from '@angular/service-worker';
import { isOnline } from '../util/is-online';
import { TranslateService } from '@ngx-translate/core';
import { Log } from './log';
import { confirmDialog } from '../util/native-dialogs';

const INITIAL_PWA_UPDATE_CHECK_TIMEOUT_MS = 8000;

@Injectable({
  providedIn: 'root',
})
export class InitialPwaUpdateCheckService {
  private _swUpdate = inject(SwUpdate);
  private _translateService = inject(TranslateService);

  // NOTE: check currently triggered by sync effect
  afterInitialUpdateCheck$: Observable<void> =
    !IS_ELECTRON && this._swUpdate.isEnabled && isOnline()
      ? defer(() => from(this._swUpdate.checkForUpdate())).pipe(
          timeout(INITIAL_PWA_UPDATE_CHECK_TIMEOUT_MS),
          catchError((err: unknown) => {
            Log.warn('InitialPwaUpdateCheckService: update check failed', err);
            return of(false);
          }),
          concatMap((isUpdateAvailable) => {
            Log.log(
              '___________isServiceWorkerUpdateAvailable____________',
              isUpdateAvailable,
            );
            if (
              isUpdateAvailable &&
              confirmDialog(this._translateService.instant(T.APP.UPDATE_WEB_APP))
            ) {
              window.location.reload();
              return EMPTY;
            }
            return of(undefined);
          }),
          shareReplay(1),
        )
      : of(undefined);
}
