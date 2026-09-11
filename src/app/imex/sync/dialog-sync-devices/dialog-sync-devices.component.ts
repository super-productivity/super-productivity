import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { SnackService } from '../../../core/snack/snack.service';
import { SyncLog } from '../../../core/log';
import { MatButton } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { PlatformCode } from '../../../core/util/generate-client-id';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import {
  SuperSyncDevicesService,
  SyncDeviceListEntry,
} from '../super-sync-devices.service';
import { T } from '../../../t.const';

interface DeviceRow extends SyncDeviceListEntry {
  icon: string;
  label: string;
}

/** How each clientId prefix is presented. Keyed by `PlatformCode` so a new code is a compile error. */
const PLATFORMS: Record<PlatformCode, { icon: string; label: string }> = {
  E: { icon: 'computer', label: T.F.SYNC.D_DEVICES.PLATFORM_DESKTOP },
  A: { icon: 'smartphone', label: T.F.SYNC.D_DEVICES.PLATFORM_ANDROID },
  I: { icon: 'smartphone', label: T.F.SYNC.D_DEVICES.PLATFORM_IOS },
  B: { icon: 'public', label: T.F.SYNC.D_DEVICES.PLATFORM_BROWSER },
};

const UNKNOWN_PLATFORM = {
  icon: 'devices_other',
  label: T.F.SYNC.D_DEVICES.PLATFORM_UNKNOWN,
};

@Component({
  selector: 'dialog-sync-devices',
  templateUrl: './dialog-sync-devices.component.html',
  styleUrls: ['./dialog-sync-devices.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    TranslateModule,
    LocaleDatePipe,
    MatIcon,
    MatProgressSpinner,
  ],
})
export class DialogSyncDevicesComponent implements OnInit {
  private _devicesService = inject(SuperSyncDevicesService);
  private _matDialog = inject(MatDialog);
  // Result type `boolean`: `true` = a sign-out rotated the stored token
  // (the settings dialog underneath must not Save its stale Formly model).
  private _matDialogRef =
    inject<MatDialogRef<DialogSyncDevicesComponent, boolean>>(MatDialogRef);
  private _snackService = inject(SnackService);

  T = T;

  devices = signal<DeviceRow[]>([]);
  isLoading = signal(true);
  isSigningOut = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const devices = await this._devicesService.getDevices();
      // Resolved here rather than in the template: the row list is rebuilt once,
      // a template call would re-run per row on every change-detection pass.
      this.devices.set(
        devices.map((device) => ({
          ...device,
          ...(device.platform ? PLATFORMS[device.platform] : UNKNOWN_PLATFORM),
        })),
      );
    } catch (e) {
      SyncLog.err('DialogSyncDevices: loading device list failed', e);
      this.error.set(T.F.SYNC.D_DEVICES.ERROR_LOADING);
    } finally {
      this.isLoading.set(false);
    }
  }

  async signOutOtherDevices(): Promise<void> {
    const confirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            title: T.F.SYNC.D_DEVICES.SIGN_OUT_CONFIRM_TITLE,
            message: T.F.SYNC.D_DEVICES.SIGN_OUT_CONFIRM_MSG,
            okTxt: T.F.SYNC.D_DEVICES.SIGN_OUT_CONFIRM_OK,
            titleIcon: 'warning',
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }

    this.isSigningOut.set(true);
    // Block every close path (button, ESC, backdrop) while the request is in
    // flight: an early close completes afterClosed(), so the close(true)
    // below could no longer tell the settings dialog the token changed and a
    // later Save would write the revoked token back. Restored on error.
    this._matDialogRef.disableClose = true;
    try {
      await this._devicesService.signOutAllOtherDevices();
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.SYNC.D_DEVICES.SIGN_OUT_SUCCESS,
      });
      // `true` tells the settings dialog underneath that the stored token
      // changed — its Formly model still holds the revoked one.
      this._matDialogRef.close(true);
    } catch (e) {
      SyncLog.err('DialogSyncDevices: sign-out failed', e);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.D_DEVICES.ERROR_SIGN_OUT,
      });
      this._matDialogRef.disableClose = false;
      this.isSigningOut.set(false);
    }
  }
}
