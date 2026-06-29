import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { T } from '../../../t.const';
import { PlainspaceAccountService } from '../plainspace-account.service';
import { PlainspaceConnectDialogComponent } from '../connect-dialog/plainspace-connect-dialog.component';
import {
  PlainspaceApiService,
  PlainspaceSpace,
} from '../../issue/providers/plainspace/plainspace-api.service';
import { DEFAULT_PLAINSPACE_CFG } from '../../issue/providers/plainspace/plainspace-cfg-form.const';

/** What the user chose: link one of their existing spaces, or create a new one. */
export type PlainspaceSpaceChoice =
  | { action: 'create' }
  | { action: 'link'; spaceId: string };

/**
 * Lets the user link an existing Plainspace space (so the tasks already assigned
 * to them import) instead of always creating a new one. Assumes a connected
 * account (the share flow ensures that first); resolves to the chosen action, or
 * `undefined` if cancelled.
 *
 * If the stored token has gone stale (e.g. revoked in Plainspace), the spaces
 * request fails and we offer a reconnect so the user can paste a fresh token —
 * without it they would be stuck (the share flow only opens the connect dialog
 * when no account exists at all). See issue #8616.
 */
@Component({
  selector: 'plainspace-space-picker-dialog',
  templateUrl: './plainspace-space-picker-dialog.component.html',
  styleUrls: ['./plainspace-space-picker-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    FormsModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatButton,
    TranslatePipe,
  ],
})
export class PlainspaceSpacePickerDialogComponent {
  private _dialogRef =
    inject<MatDialogRef<PlainspaceSpacePickerDialogComponent, PlainspaceSpaceChoice>>(
      MatDialogRef,
    );
  private _accountService = inject(PlainspaceAccountService);
  private _api = inject(PlainspaceApiService);
  private _matDialog = inject(MatDialog);

  readonly T = T;
  readonly spaces = signal<PlainspaceSpace[]>([]);
  readonly isLoading = signal(true);
  readonly hasError = signal(false);
  selectedSpaceId: string | null = null;

  constructor() {
    void this._loadSpaces();
  }

  link(): void {
    if (!this.selectedSpaceId) {
      return;
    }
    this._dialogRef.close({ action: 'link', spaceId: this.selectedSpaceId });
  }

  createNew(): void {
    this._dialogRef.close({ action: 'create' });
  }

  cancel(): void {
    this._dialogRef.close();
  }

  /**
   * Recovery for a stale/revoked token: opens the guided connect dialog (which
   * validates and stores a fresh token), then retries loading the spaces.
   */
  async reconnect(): Promise<void> {
    const reconnected = await firstValueFrom(
      this._matDialog
        .open(PlainspaceConnectDialogComponent, {
          data: { host: this._accountService.host() },
        })
        .afterClosed(),
    );
    if (reconnected === true) {
      await this._loadSpaces();
    }
  }

  private async _loadSpaces(): Promise<void> {
    this.hasError.set(false);
    this.isLoading.set(true);
    const account = this._accountService.account();
    if (!account) {
      // Should not happen — the share flow connects first — but bail safely.
      this._dialogRef.close();
      return;
    }
    const spaces = await firstValueFrom(
      this._api.getSpaces$({
        ...DEFAULT_PLAINSPACE_CFG,
        host: account.host,
        token: account.token,
      }),
    );
    // null = the request failed (vs an empty list = genuinely no spaces yet).
    if (spaces === null) {
      this.hasError.set(true);
    } else {
      this.spaces.set(spaces);
      this.selectedSpaceId = spaces[0]?.id ?? null;
    }
    this.isLoading.set(false);
  }
}
