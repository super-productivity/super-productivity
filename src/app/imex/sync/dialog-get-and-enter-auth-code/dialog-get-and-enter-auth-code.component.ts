import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
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
import { IS_ELECTRON } from '../../../app.constants';

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

  // Always use manual code entry flow (show input field on all platforms).
  // The automatic deep-link redirect flow was reverted: it requires the
  // redirect URI to be registered in the Dropbox developer console, and
  // Android may kill the app during auth, losing the in-memory code verifier.
  readonly isNativePlatform = false;
  // Flips to true once the user clicks "Get Auth Code". When true, the paste
  // field is rendered at the top of the dialog — keeps the field above the
  // iOS on-screen keyboard (discussion #7340).
  readonly codeRequested = signal(false);
  readonly isElectron = IS_ELECTRON;
  private _authCodeSub?: Subscription;

  constructor() {
    this._matDialogRef.disableClose = true;

    // Listen for OAuth callback on native and Electron for automatic auth completion.
    if (this.isNativePlatform || this.isElectron) {
      const expectedProvider = this.data.providerName.toLowerCase();
      this._authCodeSub = this._oauthCallbackHandler.authCodeReceived$.subscribe(
        (data) => {
          if (data.provider !== expectedProvider) {
            return;
          }

          if (data.error) {
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
            this._snackService.open({
              type: 'ERROR',
              msg: 'Authentication failed: No authorization code received',
            });
            this.close();
          }
        },
      );
    }
  }

  ngOnDestroy(): void {
    this._authCodeSub?.unsubscribe();
  }

  close(token?: string): void {
    this._matDialogRef.close(this._normalizeAuthCodeInput(token));
  }

  private _normalizeAuthCodeInput(token?: string): string | undefined {
    const trimmed = token?.trim();
    if (!trimmed) {
      return undefined;
    }

    // Allow pasting the full callback URL and extract `code` automatically.
    try {
      const parsedUrl = new URL(trimmed);
      const codeFromUrl = parsedUrl.searchParams.get('code');
      if (codeFromUrl) {
        return codeFromUrl;
      }
    } catch {
      // Not a URL, continue with other extraction attempts.
    }

    const codeMatch = trimmed.match(/(?:^|[?&#])code=([^&#]+)/i);
    if (codeMatch?.[1]) {
      try {
        return decodeURIComponent(codeMatch[1]);
      } catch {
        return codeMatch[1];
      }
    }

    return trimmed;
  }

  // iOS Safari only opens the keyboard when .focus() runs synchronously in the
  // same task as the user gesture — must stay in this click handler, not an
  // effect.
  onGetAuthCode(input: HTMLInputElement): void {
    this.codeRequested.set(true);
    input.focus();
  }
}
