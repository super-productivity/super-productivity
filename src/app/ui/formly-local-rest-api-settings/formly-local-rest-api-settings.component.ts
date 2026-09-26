import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { Log } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import {
  LOCAL_REST_API_HOST,
  LOCAL_REST_API_PORT,
  LocalRestApiState,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

/**
 * The local REST API switch, its status and its access token.
 *
 * All three are owned by the Electron main process and live on this device
 * only: the switch is persisted in main's simple store and the token in a 0600
 * file, never in the synced config — a synced switch used to start the listener
 * on every other desktop. So this component reads and writes them over IPC
 * rather than binding to a form control, and is keyless on purpose.
 */
@Component({
  selector: 'formly-local-rest-api-settings',
  templateUrl: './formly-local-rest-api-settings.component.html',
  styleUrl: './formly-local-rest-api-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormlyModule, MatButton, MatCheckbox, TranslatePipe],
})
export class FormlyLocalRestApiSettingsComponent
  extends FieldType<FormlyFieldConfig>
  implements OnInit
{
  readonly T = T;
  readonly url = `http://${LOCAL_REST_API_HOST}:${LOCAL_REST_API_PORT}`;
  readonly port = LOCAL_REST_API_PORT;
  readonly state = signal<LocalRestApiState | null>(null);
  readonly isEnabled = computed(() => !!this.state()?.isEnabled);
  readonly isToggling = signal(false);
  readonly token = signal<string | null>(null);
  readonly isRegenerating = signal(false);
  // There is a real state where the API is switched on and has no credential at
  // all: the main process could not store the first token, so it failed closed
  // and did not start the server. Logging that and rendering an empty field
  // reads as "no token yet", which is the one thing it does not mean.
  readonly hasTokenError = signal(false);

  private readonly _snackService = inject(SnackService);

  /** Selects a read-only field's text on focus, so it can be copied at once. */
  selectText(event: FocusEvent): void {
    (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.select();
  }

  ngOnInit(): void {
    void this._loadState();
  }

  async toggle(isEnabled: boolean): Promise<void> {
    if (this.isToggling() || !window.ea?.setLocalRestApiEnabled) {
      return;
    }
    this.isToggling.set(true);
    try {
      this.state.set(await window.ea.setLocalRestApiEnabled(isEnabled));
      if (this.isEnabled()) {
        await this._loadToken();
      } else {
        this.token.set(null);
        this.hasTokenError.set(false);
      }
    } catch (err) {
      Log.err('Failed to change the local REST API setting', err);
      this._snackService.open({
        type: 'ERROR',
        msg: T.GCF.MISC.LOCAL_REST_API_TOGGLE_ERROR,
      });
    } finally {
      this.isToggling.set(false);
    }
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
    // A successful regeneration can also be what brings a failed-closed API up.
    await this._refreshState();
  }

  private async _loadState(): Promise<void> {
    if (!window.ea?.getLocalRestApiState) {
      return;
    }
    await this._refreshState();
    // Reading the token mints one, so only do that while the API is on.
    if (this.isEnabled()) {
      await this._loadToken();
    }
  }

  private async _refreshState(): Promise<void> {
    if (!window.ea?.getLocalRestApiState) {
      return;
    }
    try {
      this.state.set(await window.ea.getLocalRestApiState());
    } catch (err) {
      Log.err('Failed to read the local REST API state', err);
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
