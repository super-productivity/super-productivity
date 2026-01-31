import { Injectable, inject } from '@angular/core';
import { IS_ELECTRON } from '../app.constants';
import { EMPTY, from, Observable, of } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import { T } from '../t.const';
import { SwUpdate } from '@angular/service-worker';
import { isOnline } from '../util/is-online';
import { TranslateService } from '@ngx-translate/core';
import { Log } from './log';
import { confirmDialog } from '../util/native-dialogs';

@Injectable({
  providedIn: 'root',
})
export class InitialPwaUpdateCheckService {
  private _swUpdate = inject(SwUpdate);
  private _translateService = inject(TranslateService);

  // NOTE: check currently triggered by sync effect
  afterInitialUpdateCheck$: Observable<void> =
    !IS_ELECTRON && this._swUpdate.isEnabled && isOnline()
      ? from(this._swUpdate.checkForUpdate()).pipe(
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
        )
      : of(undefined);
}
