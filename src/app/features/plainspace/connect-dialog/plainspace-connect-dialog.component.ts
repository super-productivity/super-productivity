import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { PlainspaceAccountService } from '../plainspace-account.service';

export interface PlainspaceConnectDialogData {
  host?: string | null;
}

/**
 * Guided "Connect to Plainspace" dialog: shows where to create a personal API
 * token (link + step-by-step), takes the pasted token and validates it against
 * the host before closing. Resolves to `true` once connected, `false` if the
 * user cancels. Replaces the bare single-line token prompt.
 */
@Component({
  selector: 'plainspace-connect-dialog',
  templateUrl: './plainspace-connect-dialog.component.html',
  styleUrls: ['./plainspace-connect-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    FormsModule,
    MatFormField,
    MatLabel,
    MatInput,
    MatButton,
    MatAnchor,
    MatIcon,
    TranslatePipe,
  ],
})
export class PlainspaceConnectDialogComponent {
  private _dialogRef =
    inject<MatDialogRef<PlainspaceConnectDialogComponent, boolean>>(MatDialogRef);
  private _accountService = inject(PlainspaceAccountService);
  private _data = inject<PlainspaceConnectDialogData | null>(MAT_DIALOG_DATA, {
    optional: true,
  });

  readonly T = T;
  readonly host = this._data?.host || 'https://plainspace.org';
  token = '';
  readonly isConnecting = signal(false);
  readonly hasError = signal(false);

  async connect(): Promise<void> {
    const token = this.token.trim();
    if (!token || this.isConnecting()) {
      return;
    }
    this.isConnecting.set(true);
    this.hasError.set(false);
    const ok = await this._accountService.connect(token, this.host);
    if (ok) {
      this._dialogRef.close(true);
    } else {
      this.hasError.set(true);
      this.isConnecting.set(false);
    }
  }

  cancel(): void {
    this._dialogRef.close(false);
  }
}
