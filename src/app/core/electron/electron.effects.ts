import { Injectable, inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { IS_ELECTRON } from '../../app.constants';
import { tap } from 'rxjs/operators';
import { SnackService } from '../snack/snack.service';
import { T } from '../../t.const';
import { ipcAnyFileDownloaded$ } from '../ipc-events';

/**
 * Extracts the downloaded file's name and directory from the ANY_FILE_DOWNLOADED
 * payload. The payload-only IPC listener strips the raw Electron event, so the
 * file is the first arg (it was [1] before the event was stripped). Returns null
 * for a missing/malformed payload so the effect never throws.
 */
export const parseDownloadedFilePayload = (
  args: unknown,
): { fileName: string; dir: string } | null => {
  const fileParam = Array.isArray(args) ? (args[0] as { path?: unknown }) : undefined;
  const path = typeof fileParam?.path === 'string' ? fileParam.path : null;
  if (!path) {
    return null;
  }
  return {
    fileName: path.replace(/^.*[\\\/]/, ''),
    dir: path.replace(/[^\/]*$/, ''),
  };
};

@Injectable()
export class ElectronEffects {
  private _snackService = inject(SnackService);

  fileDownloadedSnack$: Observable<unknown> | false =
    IS_ELECTRON &&
    createEffect(
      () =>
        ipcAnyFileDownloaded$.pipe(
          tap((args) => {
            const file = parseDownloadedFilePayload(args);
            if (!file) {
              return;
            }
            this._snackService.open({
              ico: 'file_download',
              // ico: 'file_download_done',
              // ico: 'download_done',
              msg: T.GLOBAL_SNACK.FILE_DOWNLOADED,
              translateParams: {
                fileName: file.fileName,
              },
              actionStr: T.GLOBAL_SNACK.FILE_DOWNLOADED_BTN,
              actionFn: () => {
                window.ea.openPath(file.dir);
              },
            });
          }),
        ),
      { dispatch: false },
    );
}
