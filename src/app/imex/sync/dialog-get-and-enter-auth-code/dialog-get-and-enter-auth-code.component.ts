import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from 'src/app/t.const';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OAuthCallbackHandlerService } from '../oauth-callback-handler.service';
import { Subscription } from 'rxjs';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { SnackService } from '../../../core/snack/snack.service';

@Component({
  selector: 'dialog-get-and-enter-auth-code',
  templateUrl: './dialog-get-and-enter-auth-code.component.html',
  styleUrls: ['./dialog-get-and-enter-auth-code.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatAnchor,
    MatIcon,
    MatFormField,
    MatLabel,
    MatPrefix,
    MatInput,
    FormsModule,
    MatDialogActions,
    MatButton,
    TranslatePipe,
    MatProgressSpinner,
  ],
})
export class DialogGetAndEnterAuthCodeComponent implements OnDestroy {
  private _matDialogRef =
    inject<MatDialogRef<DialogGetAndEnterAuthCodeComponent>>(MatDialogRef);
  private _oauthCallbackHandler = inject(OAuthCallbackHandlerService);
  private _snackService = inject(SnackService);

  data = inject<{
    providerName: string;
    url: string;
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;
  token?: string;

  // Always use manual code entry flow (show input field)
  readonly isNativePlatform = false;
  private _authCodeSub?: Subscription;

  constructor() {
    this._matDialogRef.disableClose = true;

    // On mobile, listen for OAuth callback
    if (this.isNativePlatform) {
      this._authCodeSub = this._oauthCallbackHandler.authCodeReceived$.subscribe(
        (data) => {
          if (data.provider === 'dropbox') {
            if (data.error) {
              // Handle error from OAuth provider
              const errorMsg = data.error_description || data.error;
              this._snackService.open({
                type: 'ERROR',
                msg: `Authentication failed: ${errorMsg}`,
              });
              this.close();
            } else if (data.code) {
              this.token = data.code;
              this.close(this.token);
            } else {
              // Unexpected case - no code and no error
              this._snackService.open({
                type: 'ERROR',
                msg: 'Authentication failed: No authorization code received',
              });
              this.close();
            }
          }
        },
      );
    }
  }

  ngOnDestroy(): void {
    this._authCodeSub?.unsubscribe();
  }

  close(token?: string): void {
    this._matDialogRef.close(token);
  }
}
