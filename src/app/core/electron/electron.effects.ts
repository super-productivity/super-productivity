import { Injectable, inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { IS_ELECTRON } from '../../app.constants';
import { tap } from 'rxjs/operators';
import { SnackService } from '../snack/snack.service';
import { T } from '../../t.const';
import { ipcAnyFileDownloaded$ } from '../ipc-events';

@Injectable()
export class ElectronEffects {
  private _snackService = inject(SnackService);

  fileDownloadedSnack$: Observable<unknown> | false =
    IS_ELECTRON &&
    createEffect(
      () =>
        ipcAnyFileDownloaded$.pipe(
          tap((args) => {
            // The payload-only IPC listener strips the raw Electron event, so
            // the download payload is now the first arg (was [1] before the
            // event was stripped). Guard against a malformed payload.
            const fileParam = (args as [{ path?: unknown }?])[0];
            const path = typeof fileParam?.path === 'string' ? fileParam.path : null;
            if (!path) {
              return;
            }
            const fileName = path.replace(/^.*[\\\/]/, '');
            const dir = path.replace(/[^\/]*$/, '');
            this._snackService.open({
              ico: 'file_download',
              // ico: 'file_download_done',
              // ico: 'download_done',
              msg: T.GLOBAL_SNACK.FILE_DOWNLOADED,
              translateParams: {
                fileName,
              },
              actionStr: T.GLOBAL_SNACK.FILE_DOWNLOADED_BTN,
              actionFn: () => {
                window.ea.openPath(dir);
              },
            });
          }),
        ),
      { dispatch: false },
    );
}
