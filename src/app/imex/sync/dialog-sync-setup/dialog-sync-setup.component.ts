import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import {
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { from } from 'rxjs';
import { SyncLog } from '../../../core/log';
import { T } from '../../../t.const';
import {
  connectLink,
  ConnectRequest,
  ConnectUnsupportedError,
  SignInOutcome,
} from '../super-sync-connect/super-sync-connect.api';
import {
  normalizeSuperSyncBaseUrl,
  SuperSyncConnectService,
} from '../super-sync-connect/super-sync-connect.service';
import { CertTrustService } from '../../../features/issue/cert-trust.service';

/** choose = 1a, waiting = 1b, timed-out = 3c, manual = 3b (mockups v3). */
type Step = 'choose' | 'waiting' | 'timed-out' | 'manual';

const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

/**
 * First sync setup: sign in to SuperSync through the browser, or pick another
 * provider in today's settings dialog. Shown while sync is off.
 */
@Component({
  selector: 'dialog-sync-setup',
  templateUrl: './dialog-sync-setup.component.html',
  styleUrls: ['./dialog-sync-setup.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    MatTooltip,
    TranslatePipe,
  ],
})
export class DialogSyncSetupComponent {
  private _connect = inject(SuperSyncConnectService);
  private _matDialog = inject(MatDialog);
  private _dialogRef = inject<MatDialogRef<DialogSyncSetupComponent>>(MatDialogRef);
  private _certTrustService = inject(CertTrustService);

  readonly T = T;
  readonly step = signal<Step>('choose');
  readonly isBusy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly matchCode = signal('');
  readonly isEditingServer = signal(false);
  serverInput = '';
  accessToken = '';

  private readonly _savedBaseUrl = toSignal(from(this._connect.savedBaseUrl()));
  private readonly _chosenBaseUrl = signal<string | null>(null);
  readonly baseUrl = computed(() => this._chosenBaseUrl() ?? this._savedBaseUrl() ?? '');
  readonly host = computed(() => hostOf(this.baseUrl()));
  // The server hides behind an icon, so a non-default one is named under the
  // button. Empty input normalizes to the default server.
  readonly isCustomServer = computed(() => {
    const baseUrl = this.baseUrl();
    return !!baseUrl && baseUrl !== normalizeSuperSyncBaseUrl('');
  });

  private _link = '';
  // Bumped by Cancel, a new attempt and closing, which ends the older poll.
  private _attempt = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this._attempt++;
      void this._certTrustService.setPendingConfig(this, null);
    });
  }

  editServer(): void {
    this.serverInput = this.baseUrl();
    this.isEditingServer.set(true);
  }

  /** Runs on a click: on the web the browser tab must open before any await. */
  async signIn(): Promise<void> {
    const baseUrl = this._applyServerInput();
    if (!baseUrl) return;
    const attempt = ++this._attempt;
    const tab = this._connect.openBlankTab();
    const request = await this._startRequest(baseUrl, attempt, tab);
    if (!request) return;
    this.step.set('waiting');
    const outcome = await this._connect.waitForApproval(
      baseUrl,
      request,
      () => attempt !== this._attempt,
    );
    await this._finish(outcome, baseUrl);
  }

  openAgain(): void {
    this._connect.openInBrowser(this._link);
  }

  cancelWaiting(): void {
    this._attempt++;
    this.step.set('choose');
  }

  backToChoose(): void {
    this.errorKey.set(null);
    this.step.set('choose');
  }

  openServerPage(): void {
    this._connect.openInBrowser(this.baseUrl());
  }

  /** 3b: today's manual setup, with the token pasted from the server page. */
  async saveAccessToken(): Promise<void> {
    const token = this.accessToken.trim();
    if (!token) return;
    this.isBusy.set(true);
    try {
      await this._connect.applyToken(token, this.baseUrl());
      this._dialogRef.close(true);
    } finally {
      this.isBusy.set(false);
    }
  }

  async openOtherOptions(): Promise<void> {
    this._dialogRef.close();
    const { DialogSyncCfgComponent } =
      await import('../dialog-sync-cfg/dialog-sync-cfg.component');
    this._matDialog.open(DialogSyncCfgComponent);
  }

  close(): void {
    this._dialogRef.close();
  }

  private _applyServerInput(): string | null {
    if (!this.isEditingServer()) return this.baseUrl();
    const baseUrl = normalizeSuperSyncBaseUrl(this.serverInput);
    if (!baseUrl) {
      this.errorKey.set(T.F.SYNC.D_SIGN_IN.INVALID_SERVER);
      return null;
    }
    this._chosenBaseUrl.set(baseUrl);
    this.isEditingServer.set(false);
    return baseUrl;
  }

  /** Creates the request and opens the browser; null when it can't or the user moved on. */
  private async _startRequest(
    baseUrl: string,
    attempt: number,
    tab: Window | null,
  ): Promise<ConnectRequest | null> {
    this.errorKey.set(null);
    this.isBusy.set(true);
    try {
      // A self-hosted server with a self-signed cert must work before it is saved (#11097)
      await this._certTrustService.setPendingConfig(this, { baseUrl });
      const request = await this._connect.start(baseUrl);
      if (attempt !== this._attempt) {
        tab?.close();
        return null;
      }
      this._link = connectLink(baseUrl, request.requestId);
      this.matchCode.set(request.matchCode);
      this._connect.openInBrowser(this._link, tab);
      return request;
    } catch (e) {
      tab?.close();
      if (attempt === this._attempt) this._showStartError(e);
      return null;
    } finally {
      this.isBusy.set(false);
    }
  }

  private async _finish(outcome: SignInOutcome, baseUrl: string): Promise<void> {
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind !== 'approved') {
      this.step.set('timed-out');
      return;
    }
    this._connect.returnToApp();
    await this._connect.applyToken(outcome.token, baseUrl);
    this._dialogRef.close(true);
  }

  private _showStartError(e: unknown): void {
    if (e instanceof ConnectUnsupportedError) {
      this.step.set('manual');
      return;
    }
    SyncLog.warn('SuperSync sign-in could not start', {
      name: e instanceof Error ? e.name : typeof e,
    });
    this.step.set('choose');
    this.errorKey.set(T.F.SYNC.D_SIGN_IN.START_FAILED);
  }
}
