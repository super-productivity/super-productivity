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
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  ASSISTANT_ACCESS_PATH,
  AssistantAccessScope,
  AssistantAccessState,
} from '../../../../electron/shared-with-frontend/assistant-access.model';

const KEY_PLACEHOLDER = '<ACCESS_KEY>';

/**
 * Assistant (MCP) access: switch, granted permissions, access key and client
 * setup snippets.
 *
 * Like the REST API settings, everything here is owned by the Electron main
 * process and stays on this device; the component talks to it over IPC and is
 * keyless on purpose. The access key is only ever known right after it was
 * generated — main keeps a verifier, not the key — so it is shown once.
 */
@Component({
  selector: 'formly-assistant-access-settings',
  templateUrl: './formly-assistant-access-settings.component.html',
  styleUrl: './formly-assistant-access-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormlyModule, MatButton, MatCheckbox, TranslatePipe],
})
export class FormlyAssistantAccessSettingsComponent
  extends FieldType<FormlyFieldConfig>
  implements OnInit
{
  readonly T = T;
  readonly url = `http://${LOCAL_REST_API_HOST}:${LOCAL_REST_API_PORT}${ASSISTANT_ACCESS_PATH}`;
  readonly port = LOCAL_REST_API_PORT;
  readonly state = signal<AssistantAccessState | null>(null);
  readonly isBusy = signal(false);
  /** Only set right after generating; never read back from main. */
  readonly newKey = signal<string | null>(null);

  readonly isEnabled = computed(() => !!this.state()?.isEnabled);
  readonly hasScope = (scope: AssistantAccessScope): boolean =>
    !!this.state()?.scopes.includes(scope);

  readonly claudeCodeSnippet = computed(
    () =>
      `claude mcp add --scope user --transport http super-productivity ${this.url} ` +
      `--header "Authorization: Bearer ${this.newKey() ?? KEY_PLACEHOLDER}"`,
  );
  readonly jsonSnippet = computed(() =>
    JSON.stringify(
      {
        mcpServers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'super-productivity': {
            type: 'http',
            url: this.url,
            headers: { Authorization: `Bearer ${this.newKey() ?? KEY_PLACEHOLDER}` },
          },
        },
      },
      null,
      2,
    ),
  );

  private readonly _snackService = inject(SnackService);

  /** Selects a read-only field's text on focus, so it can be copied at once. */
  selectText(event: FocusEvent): void {
    (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.select();
  }

  ngOnInit(): void {
    void this._run(async (ea) => ea.getAssistantAccessState());
  }

  async toggle(isEnabled: boolean): Promise<void> {
    await this._run((ea) => ea.setAssistantAccessEnabled(isEnabled));
  }

  async setScope(scope: AssistantAccessScope, isGranted: boolean): Promise<void> {
    const current = this.state()?.scopes ?? [];
    const next = isGranted
      ? [...current, scope]
      : current.filter(
          (s) =>
            s !== scope &&
            // Notes are only reachable through a task read.
            !(scope === 'tasks:read' && s === 'tasks:read_notes'),
        );
    await this._run((ea) => ea.setAssistantAccessScopes(next));
  }

  async generateKey(): Promise<void> {
    await this._run(async (ea) => {
      const { credential, state } = await ea.rotateAssistantAccessCredential();
      this.newKey.set(credential);
      return state;
    });
  }

  private async _run(
    action: (ea: NonNullable<typeof window.ea>) => Promise<AssistantAccessState>,
  ): Promise<void> {
    if (this.isBusy() || !window.ea?.getAssistantAccessState) {
      return;
    }
    this.isBusy.set(true);
    try {
      this.state.set(await action(window.ea));
    } catch (err) {
      // Never log the key — the app has a user-visible log export.
      Log.err('Assistant access settings: IPC call failed', err);
      this._snackService.open({
        type: 'ERROR',
        msg: T.GCF.MISC.ASSISTANT_ACCESS_SAVE_ERROR,
      });
    } finally {
      this.isBusy.set(false);
    }
  }
}
