import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { Log } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';

/**
 * Displays the local REST API access token and lets the user regenerate it.
 *
 * The token is owned by the Electron main process (persisted to a 0600 file, not
 * the synced config), so this component reads and regenerates it over IPC rather
 * than binding to a form control. It is keyless on purpose — nothing here is
 * written back into the misc config model.
 */
@Component({
  selector: 'formly-local-rest-api-token',
  templateUrl: './formly-local-rest-api-token.component.html',
  styleUrl: './formly-local-rest-api-token.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormlyModule, MatButton, TranslatePipe],
})
export class FormlyLocalRestApiTokenComponent
  extends FieldType<FormlyFieldConfig>
  implements OnInit
{
  readonly T = T;
  readonly token = signal<string | null>(null);
  readonly isRegenerating = signal(false);
  // There is a real state where the API is switched on and has no credential at
  // all: the main process could not store the first token, so it failed closed
  // and did not start the server. Logging that and rendering an empty field
  // reads as "no token yet", which is the one thing it does not mean.
  readonly hasTokenError = signal(false);

  private readonly _snackService = inject(SnackService);

  ngOnInit(): void {
    void this._loadToken();
  }

  async regenerate(): Promise<void> {
    if (this.isRegenerating() || !window.ea?.regenerateLocalRestApiToken) {
      return;
    }
    this.isRegenerating.set(true);
    try {
      // Never log the token itself — the app has a user-visible log export.
      this.token.set(await window.ea.regenerateLocalRestApiToken());
      this.hasTokenError.set(false);
    } catch (err) {
      // The main process rejects when the new token could not be stored, and it
      // keeps the old one live in that case. Say so instead of leaving the user
      // to believe the token they are looking at was rotated — but only when
      // there *is* a previous token: after a failed first generation there is
      // none, and claiming one still works would be a lie.
      Log.err('Failed to regenerate local REST API token', err);
      const hasPreviousToken = this.token() !== null;
      this._snackService.open({
        type: 'ERROR',
        msg: hasPreviousToken
          ? T.GCF.MISC.LOCAL_REST_API_TOKEN_REGENERATE_ERROR
          : T.GCF.MISC.LOCAL_REST_API_TOKEN_ERROR,
      });
      this.hasTokenError.set(!hasPreviousToken);
    } finally {
      this.isRegenerating.set(false);
    }
  }

  private async _loadToken(): Promise<void> {
    if (!window.ea?.getLocalRestApiToken) {
      return;
    }
    try {
      this.token.set(await window.ea.getLocalRestApiToken());
      this.hasTokenError.set(false);
    } catch (err) {
      Log.err('Failed to load local REST API token', err);
      this.token.set(null);
      this.hasTokenError.set(true);
    }
  }
}
