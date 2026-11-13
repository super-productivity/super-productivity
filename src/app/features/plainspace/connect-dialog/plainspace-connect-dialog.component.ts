import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { T } from '../../../t.const';
import { IS_ELECTRON } from '../../../app.constants';
import {
  PlainspaceAccountService,
  PlainspaceConnectResult,
} from '../plainspace-account.service';
import {
  PlainspaceAuthApiService,
  PlainspaceAuthFailure,
} from '../plainspace-auth-api.service';

export interface PlainspaceConnectDialogData {
  host?: string | null;
  /**
   * The token this connect replaces, when reconnecting one provider whose
   * token was rejected; providers holding it get the new one (#8616).
   */
  replacedToken?: string | null;
  /**
   * The name for the first Space if the account turns out to be new: the
   * project being shared. Defaults to "<name>'s Plainspace".
   */
  spaceName?: string | null;
}

/**
 * `true` once connected; `{ createdSpaceId }` when connecting created the new
 * account's first Space, so the share flow links it instead of asking.
 */
export type PlainspaceConnectDialogResult = true | { createdSpaceId: string };

type Step = 'email' | 'code' | 'name' | 'replace' | 'retry' | 'browser';

interface DialogError {
  key: string;
  params?: Record<string, number>;
}

interface PendingKey {
  token: string;
  oldTokens: string[];
  createdSpaceId: string | null;
}

// No answer, or a disconnect during the check: the key itself is fine.
const isRetryable = (res: PlainspaceConnectResult): boolean =>
  res === 'unreachable' || res === 'aborted';

// Plainspace's windows (`CODE_REQUEST_WINDOW_MS`; the per-IP connect and
// create caps): it sends no Retry-After, so the wait is named from these.
const CODE_REQUEST_WAIT_MIN = 2;
const CODE_REQUEST_WAIT_MS = CODE_REQUEST_WAIT_MIN * 60_000;
const ATTEMPT_WAIT_MIN = 15;
// Plainspace's `MAX_PROJECT_NAME_LENGTH` and `MAX_DISPLAY_NAME_LENGTH`.
const MAX_SPACE_NAME_LENGTH = 100;
const MAX_DISPLAY_NAME_LENGTH = 40;

/**
 * "Connect to Plainspace": signs in or signs up with an emailed 6-digit code,
 * the same endpoints as Plainspace's connect page, so no browser hop and no
 * pasted token. A host without them (404) falls back to the browser step:
 * open Plainspace, then paste the token. Either way the token is validated and
 * stored by `PlainspaceAccountService.connect`, as before.
 *
 * The email and the code live only in this dialog, are never persisted by it
 * and never logged.
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
    MatHint,
    MatInput,
    MatButton,
    MatAnchor,
    MatIcon,
    DatePipe,
    TranslatePipe,
  ],
})
export class PlainspaceConnectDialogComponent {
  private _dialogRef =
    inject<
      MatDialogRef<
        PlainspaceConnectDialogComponent,
        PlainspaceConnectDialogResult | false
      >
    >(MatDialogRef);
  private _accountService = inject(PlainspaceAccountService);
  private _authApi = inject(PlainspaceAuthApiService);
  private _data = inject<PlainspaceConnectDialogData | null>(MAT_DIALOG_DATA, {
    optional: true,
  });

  readonly T = T;
  readonly host = this._data?.host || 'https://plainspace.org';
  // Trailing slash stripped so we never produce a double slash.
  private readonly _origin = this.host.replace(/\/+$/, '');
  // Deep link to the dedicated "from Super Productivity" onboarding flow, which
  // guides token creation — instead of dropping the user on the bare marketing
  // host.
  //
  // On desktop we also pass a `?return=` deep link so the connect page can bounce
  // the user back to the app. Only Electron registers the `superproductivity://`
  // scheme (mobile uses a different one, web none), so gate it on IS_ELECTRON —
  // otherwise the page would render dead "Open Super Productivity" buttons.
  readonly connectUrl =
    `${this._origin}/connect/super-productivity` +
    (IS_ELECTRON
      ? `?return=${encodeURIComponent('superproductivity://plainspace-connect')}`
      : '');
  // The host's own terms apply (self-hosters' included); SP copies no legal text.
  readonly legalParams = {
    termsUrl: `${this._origin}/terms`,
    privacyUrl: `${this._origin}/privacy`,
  };
  readonly maxDisplayNameLength = MAX_DISPLAY_NAME_LENGTH;

  readonly step = signal<Step>('email');
  readonly isBusy = signal(false);
  readonly error = signal<DialogError | null>(null);
  /** The host has no email-code sign-in, so the browser step was forced. */
  readonly isBrowserFallback = signal(false);
  /** Seconds until another code may be requested. */
  readonly resendIn = signal(0);
  /** When the active key was created and last used, for the replace step. */
  readonly activeKey = signal<{ createdAt: string | null; lastUsedAt: string | null }>({
    createdAt: null,
    lastUsedAt: null,
  });

  /**
   * A working key this device already holds for the account (e.g. on providers
   * synced from another device): offered before replacing the active key.
   */
  readonly existingToken = signal<string | null>(null);

  email = '';
  code = '';
  displayName = '';
  token = '';
  /** The email the code was sent to: edits to the field don't change it. */
  readonly sentTo = signal('');

  readonly errorMsg = computed(() => this.error()?.key ?? null);

  private _resendTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * A key minted but not yet stored: the check that stores it failed. Kept for
   * Retry, since minting revoked the previous key and consumed the code.
   */
  private _pendingKey: PendingKey | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this._stopResendTimer());
  }

  async requestCode(): Promise<void> {
    const email = this.email.trim();
    if (!email || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    this.error.set(null);
    const res = await firstValueFrom(this._authApi.requestCode$(this.host, email));
    this.isBusy.set(false);
    switch (res.status) {
      case 'sent':
        this.sentTo.set(email);
        this.code = '';
        this._startResendTimer();
        this.step.set('code');
        return;
      case 'unsupported':
        this.isBrowserFallback.set(true);
        this.step.set('browser');
        return;
      case 'invalid-email':
        this.error.set({ key: T.PLAINSPACE.CONNECT.INVALID_EMAIL });
        return;
      case 'rate-limited':
        if (this.step() === 'code') {
          this._startResendTimer();
        }
        this._showFailure(res, CODE_REQUEST_WAIT_MIN);
        return;
      default:
        this._showFailure(res, CODE_REQUEST_WAIT_MIN);
    }
  }

  /** Checks the code; a returning account gets its key, a new one a name step. */
  async submitCode(force = false): Promise<void> {
    if (!this.isCodeValid() || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    this.error.set(null);
    let oldTokens: string[] = [];
    if (force) {
      // Before the replacement revokes it, while it still answers.
      oldTokens = await this._accountService.findAccountTokens(this.host, this.sentTo());
    }
    const res = await firstValueFrom(
      this._authApi.connect$(this.host, this.sentTo(), this.code, force),
    );
    switch (res.status) {
      case 'connected':
        await this._finish(res.token, oldTokens, null);
        return;
      case 'already-connected': {
        // Using a key this device already holds keeps every other device and
        // app connected; replacing it is only offered next to that.
        const [existing] = await this._accountService.findAccountTokens(
          this.host,
          this.sentTo(),
        );
        this.isBusy.set(false);
        this.existingToken.set(existing ?? null);
        this.activeKey.set({ createdAt: res.createdAt, lastUsedAt: res.lastUsedAt });
        this.step.set('replace');
        return;
      }
      case 'no-account':
        this.isBusy.set(false);
        this.step.set('name');
        return;
      default:
        this.isBusy.set(false);
        this._showCodeFailure(res);
    }
  }

  /** The other app or device holding the active key then needs the new one. */
  replaceKey(): Promise<void> {
    return this.submitCode(true);
  }

  /** Connects with the working key this device already holds; nothing is revoked. */
  async useExistingKey(): Promise<void> {
    const token = this.existingToken();
    if (!token || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    this.error.set(null);
    const res = await this._accountService.connect(
      token,
      this.host,
      this._data?.replacedToken,
    );
    if (res === 'ok') {
      this._dialogRef.close(true);
      return;
    }
    this.isBusy.set(false);
    this._showConnectFailure(res);
  }

  /** Stores a minted key whose check failed before. */
  async retryStore(): Promise<void> {
    const key = this._pendingKey;
    if (!key || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    this.error.set(null);
    await this._finish(key.token, key.oldTokens, key.createdSpaceId);
  }

  /** A new account: create its first Space, then mint its key. */
  async createAccount(): Promise<void> {
    const displayName = this.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
    if (!displayName || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    this.error.set(null);
    const res = await firstValueFrom(
      this._authApi.createSpace$(this.host, {
        name: this._spaceName(displayName),
        displayName,
        email: this.sentTo(),
        code: this.code,
      }),
    );
    if (res.status !== 'created') {
      this.isBusy.set(false);
      this._showCodeFailure(res);
      return;
    }
    const token = await firstValueFrom(
      this._authApi.createApiToken$(this.host, res.space),
    );
    if (!token) {
      // The account and its Space exist now; the browser path finishes it.
      this.isBusy.set(false);
      this.error.set({ key: T.PLAINSPACE.CONNECT.KEY_FAILED });
      this.step.set('browser');
      return;
    }
    await this._finish(token, [], res.space.id);
  }

  /** The browser step: validates and stores a pasted token. */
  async connect(): Promise<void> {
    const token = this.token.trim();
    if (!token || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    this.error.set(null);
    const res: PlainspaceConnectResult = await this._accountService.connect(
      token,
      this.host,
      this._data?.replacedToken,
    );
    if (res === 'ok') {
      this._dialogRef.close(true);
      return;
    }
    this._showConnectFailure(res);
    this.isBusy.set(false);
  }

  isCodeValid(): boolean {
    return /^\d{6}$/.test(this.code.trim());
  }

  useBrowser(): void {
    this.error.set(null);
    this.step.set('browser');
  }

  /** Back to the email step, e.g. for a different address or a new code. */
  changeEmail(): void {
    this.error.set(null);
    this.code = '';
    this.step.set('email');
  }

  cancel(): void {
    this._dialogRef.close(false);
  }

  /**
   * Stores a freshly minted key. Its check is retried once on no answer; if it
   * still fails, the key stays here for Retry instead of being dropped.
   */
  private async _finish(
    token: string,
    oldTokens: string[],
    createdSpaceId: string | null,
  ): Promise<void> {
    const store = (): Promise<PlainspaceConnectResult> =>
      this._accountService.connect(
        token,
        this.host,
        this._data?.replacedToken,
        oldTokens,
      );
    let res = await store();
    if (isRetryable(res)) {
      res = await store();
    }
    if (res === 'ok') {
      this._pendingKey = null;
      this._dialogRef.disableClose = false;
      this._dialogRef.close(createdSpaceId ? { createdSpaceId } : true);
      return;
    }
    this.isBusy.set(false);
    if (isRetryable(res)) {
      this._pendingKey = { token, oldTokens, createdSpaceId };
      // Closing now would drop the only working key (Escape, backdrop and
      // Android back all respect this); Cancel is hidden on this step.
      this._dialogRef.disableClose = true;
      this.error.set({ key: T.PLAINSPACE.CONNECT.UNREACHABLE });
      this.step.set('retry');
      return;
    }
    this._pendingKey = null;
    this._showConnectFailure(res);
  }

  private _spaceName(displayName: string): string {
    const name = this._data?.spaceName?.trim();
    return (name || `${displayName}'s Plainspace`).slice(0, MAX_SPACE_NAME_LENGTH);
  }

  private _showCodeFailure(
    res: { status: 'invalid-code' } | PlainspaceAuthFailure,
  ): void {
    if (res.status === 'invalid-code') {
      this.error.set({ key: T.PLAINSPACE.CONNECT.INVALID_CODE });
      // A replace or a create whose code expired goes back to the code step.
      this.step.set('code');
      return;
    }
    this._showFailure(res, ATTEMPT_WAIT_MIN);
  }

  private _showFailure(res: PlainspaceAuthFailure, waitMinutes: number): void {
    this.error.set(
      res.status === 'rate-limited'
        ? { key: T.PLAINSPACE.CONNECT.RATE_LIMITED, params: { minutes: waitMinutes } }
        : res.status === 'unreachable'
          ? { key: T.PLAINSPACE.CONNECT.UNREACHABLE }
          : { key: T.PLAINSPACE.CONNECT.FAILED },
    );
  }

  // `aborted` is deliberately silent: the user disconnected mid-check, so there
  // is nothing to warn them about.
  private _showConnectFailure(res: Exclude<PlainspaceConnectResult, 'ok'>): void {
    this.error.set(
      res === 'unreachable'
        ? { key: T.PLAINSPACE.CONNECT.UNREACHABLE }
        : res === 'invalid-token'
          ? { key: T.PLAINSPACE.CONNECT.INVALID }
          : res === 'other-account'
            ? { key: T.PLAINSPACE.CONNECT.OTHER_ACCOUNT }
            : null,
    );
  }

  private _startResendTimer(): void {
    this._stopResendTimer();
    const until = Date.now() + CODE_REQUEST_WAIT_MS;
    const tick = (): void => {
      const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      this.resendIn.set(seconds);
      if (!seconds) {
        this._stopResendTimer();
      }
    };
    tick();
    this._resendTimer = setInterval(tick, 1000);
  }

  private _stopResendTimer(): void {
    if (this._resendTimer) {
      clearInterval(this._resendTimer);
      this._resendTimer = null;
    }
  }
}
