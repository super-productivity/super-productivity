import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { SnackService } from '../../core/snack/snack.service';
import { download } from '../../util/download';
import { DialogImportFromUrlComponent } from '../dialog-import-from-url/dialog-import-from-url.component';
import { T } from '../../t.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { ActivatedRoute, Router } from '@angular/router';
import { privacyExport } from './privacy-export';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { AppDataCompleteNew } from '../../pfapi/pfapi-config';
import { PfapiService } from 'src/app/pfapi/pfapi.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { first } from 'rxjs/operators';
import {
  ConfirmUrlImportDialogComponent,
  DialogConfirmUrlImportData,
} from '../dialog-confirm-url-import/dialog-confirm-url-import.component';
import { Log } from '../../core/log';
import { DataValidationFailedError } from '../../pfapi/api/errors/errors';

@Component({
  selector: 'file-imex',
  templateUrl: './file-imex.component.html',
  styleUrls: ['./file-imex.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MatTooltip, TranslatePipe],
})
export class FileImexComponent implements OnInit {
  private _snackService = inject(SnackService);
  private _router = inject(Router);
  private _pfapiService = inject(PfapiService);
  private _activatedRoute = inject(ActivatedRoute);
  private _matDialog = inject(MatDialog);
  private _http = inject(HttpClient);

  readonly fileInputRef = viewChild<ElementRef>('fileInput');
  T: typeof T = T;

  ngOnInit(): void {
    this._activatedRoute.queryParams.pipe(first()).subscribe((params) => {
      const importUrlParam = params['importFromUrl'];
      if (importUrlParam) {
        // Clear the parameter from the URL immediately
        this._router.navigate([], {
          relativeTo: this._activatedRoute,
          queryParams: { importFromUrl: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });

        let decodedUrl: string;
        try {
          decodedUrl = decodeURIComponent(importUrlParam);
        } catch (e) {
          Log.err('Error decoding importFromUrl parameter:', e);
          this._snackService.open({
            type: 'ERROR',
            msg: T.FILE_IMEX.S_IMPORT_FROM_URL_ERR_DECODE,
          });
          return;
        }

        this._matDialog
          .open<ConfirmUrlImportDialogComponent, DialogConfirmUrlImportData, boolean>(
            ConfirmUrlImportDialogComponent,
            {
              data: { domain: new URL(decodedUrl).hostname },
            },
          )
          .afterClosed()
          .subscribe(async (confirmed) => {
            if (confirmed) {
              await this.importFromUrlHandler(decodedUrl);
            }
          });
      }
    });
  }

  // NOTE: after promise done the file is NOT yet read
  async handleFileInput(ev: Event): Promise<void> {
    const files = (ev.target as HTMLInputElement).files;
    const file = files?.item(0);

    if (!file) {
      // No file selected or selection cancelled
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const textData = reader.result as string;
      await this._processAndImportData(textData);

      const fileInputRef = this.fileInputRef();
      if (!fileInputRef) {
        throw new Error('No file input Ref element');
      }

      // clear input
      fileInputRef.nativeElement.value = '';
      fileInputRef.nativeElement.type = 'text';
      fileInputRef.nativeElement.type = 'file';
    };
    reader.readAsText(file);
  }

  async importFromUrlHandler(url: string): Promise<void> {
    if (!url) {
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_INVALID_URL });
      return;
    }

    try {
      const textData = await this._http
        .get(url, {
          headers: {
            Accept: 'application/json',
          },
          responseType: 'text',
        })
        .toPromise();

      await this._processAndImportData(textData);
    } catch (error) {
      // Handle network errors and HTTP errors
      Log.err('Network error or HTTP error fetching from URL:', error);
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_NETWORK });
    }
  }

  openUrlImportDialog(): void {
    this._matDialog
      .open(DialogImportFromUrlComponent, {
        width: '500px', // Or any other appropriate width
      })
      .afterClosed()
      .subscribe(async (url: string | undefined) => {
        if (url) {
          await this.importFromUrlHandler(url);
        }
      });
  }

  private async _processAndImportData(dataString: string): Promise<void> {
    let data: AppDataCompleteNew | undefined;
    let oldData: unknown; // For V1 legacy data format check

    try {
      data = oldData = JSON.parse(dataString);
    } catch (e) {
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_INVALID_DATA });
      return; // Exit if JSON parsing fails
    }

    if (!data || !oldData) {
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_INVALID_DATA });
      return; // Exit if data is falsy
    }

    // V1 data check (as in original handleFileInput)
    // TODO: consider if this check is still relevant or can be removed/updated
    const v1Data = oldData as { config?: unknown; tasks?: unknown };
    if (v1Data.config && Array.isArray(v1Data.tasks)) {
      alert('V1 Data. Migration not supported any more.');
      // Potentially also use snackService here or log an error.
      // For now, keeping alert as per original logic.
      return;
    }

    try {
      await this._router.navigate([`tag/${TODAY_TAG.id}/tasks`]);
      await this._pfapiService.importCompleteBackup(data as AppDataCompleteNew);
      // Optionally, add a success snackbar here if desired
      // this._snackService.open({ type: 'SUCCESS', msg: 'Data imported successfully!' });
    } catch (e) {
      Log.err('Import process failed', e);

      if (e instanceof DataValidationFailedError) {
        this._snackService.open({
          type: 'ERROR',
          msg: `Import failed: ${e.message}`,
          isSkipTranslate: true,
        });
      } else {
        this._snackService.open({
          type: 'ERROR',
          msg: T.FILE_IMEX.S_ERR_IMPORT_FAILED,
        });
      }
    }
  }

  async downloadBackup(): Promise<void> {
    const data = await this._pfapiService.pf.loadCompleteBackup();
    const result = await download('super-productivity-backup.json', JSON.stringify(data));
    if ((IS_ANDROID_WEB_VIEW && !result.wasCanceled) || result.isSnap) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: result.path
          ? `Backup saved to: ${result.path}`
          : T.FILE_IMEX.S_BACKUP_DOWNLOADED,
      });
    }
    // download('super-productivity-backup.json', privacyExport(data));
  }

  async privacyAppDataDownload(): Promise<void> {
    const data = await this._pfapiService.pf.loadCompleteBackup();
    const result = await download('super-productivity-backup.json', privacyExport(data));
    if ((IS_ANDROID_WEB_VIEW && !result.wasCanceled) || result.isSnap) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: result.path
          ? `Backup saved to: ${result.path}`
          : T.FILE_IMEX.S_BACKUP_DOWNLOADED,
      });
    }
  }
}
