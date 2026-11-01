import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { ConfigOption, FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';
import { TranslatePipe } from '@ngx-translate/core';
import {
  type SuperSyncCaptureGrantInfo,
  SuperSyncCaptureUnsupportedError,
} from '@sp/sync-providers/super-sync';
import { firstValueFrom } from 'rxjs';
import { Log } from '../../../../core/log';
import { ShareService } from '../../../../core/share/share.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { DialogConfirmComponent } from '../../../../ui/dialog-confirm/dialog-confirm.component';
import { LocaleDatePipe } from '../../../../ui/pipes/locale-date.pipe';
import { AgentCaptureService } from '../agent-capture.service';

/**
 * SuperSync settings block for agent task capture: switch, MCP URL, tokens
 * and connected assistants. Keyless: it acts on the server and the synced
 * `sync.captureKey` through AgentCaptureService, never on the form model.
 */
@Component({
  selector: 'agent-capture-settings',
  templateUrl: './agent-capture-settings.component.html',
  styleUrl: './agent-capture-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormlyModule,
    MatButton,
    MatIconButton,
    MatFormField,
    MatLabel,
    MatIcon,
    MatInput,
    TranslatePipe,
    LocaleDatePipe,
  ],
})
export class AgentCaptureSettingsComponent extends FieldType<FormlyFieldConfig> {
  readonly T = T;
  private readonly _capture = inject(AgentCaptureService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _shareService = inject(ShareService);

  readonly isAvailable = this._capture.isSuperSyncActive();
  readonly isEnabled = this._capture.isEnabled;
  readonly isBusy = signal(false);
  readonly mcpUrl = signal<string | null>(null);
  readonly grants = signal<SuperSyncCaptureGrantInfo[]>([]);
  readonly clientName = signal('');
  /** Shown once, held only by this component; never logged. */
  readonly connectCode = signal<{ code: string; expiresAt: number } | null>(null);
  readonly newToken = signal<string | null>(null);
  /** Ready to paste: the token is filled in, so setup is one copy. */
  readonly setupCommand = computed(
    () =>
      `claude mcp add --transport http super-productivity ${this.mcpUrl()} ` +
      `--header "Authorization: Bearer ${this.newToken()}"`,
  );

  constructor() {
    super();
    // Also when capture is switched on from another device while this is open.
    effect(() => {
      if (this.isAvailable && this.isEnabled()) {
        untracked(() => void this._run(() => this._load()));
      }
    });
  }

  turnOn(): Promise<void> {
    return this._run(async () => {
      await this._capture.switchOn();
      await this._load();
    });
  }

  turnOff(): Promise<void> {
    return this._run(async () => {
      const count = await this._capture.countPending();
      const msg = count
        ? T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_OFF_CONFIRM
        : T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_OFF_CONFIRM_NONE;
      if (!(await this._confirm(msg, { count }))) return;
      await this._capture.switchOff();
      this.grants.set([]);
      this.newToken.set(null);
      this.connectCode.set(null);
    });
  }

  createConnectCode(): Promise<void> {
    return this._run(async () => {
      this.connectCode.set(await this._capture.createConnectCode());
    });
  }

  refreshGrants(): Promise<void> {
    return this._run(() => this._load());
  }

  createToken(): Promise<void> {
    const clientName = this.clientName().trim();
    if (!clientName) return Promise.resolve();
    return this._run(async () => {
      const { token, grant } = await this._capture.createToken(clientName);
      this.newToken.set(token);
      this.clientName.set('');
      this.grants.update((grants) => [...grants, grant]);
    });
  }

  revoke(grant: SuperSyncCaptureGrantInfo, isDiscard: boolean): Promise<void> {
    const msg = isDiscard
      ? T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_REVOKE_DISCARD_CONFIRM
      : T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_REVOKE_CONFIRM;
    return this._run(async () => {
      const params = { name: grant.clientName, count: grant.pendingCount };
      if (!(await this._confirm(msg, params))) return;
      await this._capture.revokeGrant(grant.id, isDiscard);
      this.grants.update((grants) => grants.filter((g) => g.id !== grant.id));
    });
  }

  async copy(text: string, successMsg: string): Promise<void> {
    const result = await this._shareService.copyToClipboard(text, successMsg);
    if (!result.success) {
      this._snackService.open(T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_S_COPY_FAILED);
    }
  }

  private async _load(): Promise<void> {
    this.mcpUrl.set(await this._capture.getMcpUrl());
    this.grants.set(await this._capture.listGrants());
  }

  private _confirm(message: string, translateParams: object): Promise<boolean> {
    const ref = this._matDialog.open(DialogConfirmComponent, {
      restoreFocus: true,
      data: { message, translateParams },
    });
    return firstValueFrom(ref.afterClosed());
  }

  /** One request at a time; failures surface as a snack, logged without content. */
  private async _run(fn: () => Promise<void>): Promise<void> {
    if (this.isBusy()) return;
    this.isBusy.set(true);
    try {
      await fn();
    } catch (e) {
      Log.err('Agent capture settings action failed', {
        name: e instanceof Error ? e.name : typeof e,
      });
      this._snackService.open({
        type: 'ERROR',
        // Retrying cannot help on a server without capture: say so.
        msg:
          e instanceof SuperSyncCaptureUnsupportedError
            ? T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_S_UNSUPPORTED
            : T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_S_ERROR,
      });
    } finally {
      this.isBusy.set(false);
    }
  }
}

/** Formly config registering this block; provided once in main.ts. */
export const AGENT_CAPTURE_SETTINGS_FORMLY_CONFIG: ConfigOption = {
  types: [
    {
      name: 'agent-capture-settings',
      component: AgentCaptureSettingsComponent,
      wrappers: [],
    },
  ],
};
