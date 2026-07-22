import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { Log } from '../../core/log';

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
    } catch (err) {
      Log.err('Failed to regenerate local REST API token', err);
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
    } catch (err) {
      Log.err('Failed to load local REST API token', err);
    }
  }
}
