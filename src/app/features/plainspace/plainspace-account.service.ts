import { Injectable, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { LS } from '../../core/persistence/storage-keys.const';
import { Log } from '../../core/log';
import { PlainspaceAccount } from './plainspace-account.model';
import { PlainspaceApiService } from '../issue/providers/plainspace/plainspace-api.service';
import { DEFAULT_PLAINSPACE_CFG } from '../issue/providers/plainspace/plainspace-cfg-form.const';
import { PlainspaceConnectionStateService } from '../issue/providers/plainspace/plainspace-connection-state.service';
import { IssueProviderPlainspace } from '../issue/issue.model';
import { IssueProviderActions } from '../issue/store/issue-provider.actions';
import { selectAll as selectAllIssueProviders } from '../issue/store/issue-provider.selectors';

const DEFAULT_HOST = 'https://plainspace.org';

/**
 * Why a connect attempt ended. `aborted` means the user disconnected while the
 * check was in flight — not a failure worth reporting to them.
 */
export type PlainspaceConnectResult =
  | 'ok'
  | 'invalid-token'
  | 'unreachable'
  | 'aborted'
  | 'other-account';

/**
 * Holds the connected Plainspace account (a personal API token + host) and
 * exposes it as signals. The account record itself is local-only (localStorage,
 * never synced). Note: sharing a project also copies the token into a bound
 * `PLAINSPACE` issue provider, and providers ARE synced — so a copy of the token
 * can reach other devices that way (as with every issue provider's credentials).
 * Used by the share flow, which needs a token before any provider/space exists.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceAccountService {
  private readonly _api = inject(PlainspaceApiService);
  private readonly _store = inject(Store);
  private readonly _connectionState = inject(PlainspaceConnectionStateService);
  private readonly _account = signal<PlainspaceAccount | null>(this._load());
  private _logoutVersion = 0;

  readonly account = this._account.asReadonly();
  readonly isLoggedIn = computed(() => !!this._account());
  readonly token = computed(() => this._account()?.token ?? null);
  readonly host = computed(() => this._account()?.host ?? null);

  /**
   * Validates a PAT against the host (`GET /api/integration/me`) and, on
   * success, stores it. Reports *why* it failed so the caller can tell a
   * rejected token apart from an unreachable host (#9988).
   *
   * A reconnect also hands the new token to every Plainspace provider that
   * still holds a token it replaces (#8616): `replacedToken` (a provider's
   * reconnect) and this device's previous account token when it is the same
   * account. Plainspace keeps one active token per account and minting one
   * revokes the previous, so both are dead once the new one exists. Matching
   * on the token itself scopes it to the same host and account; a provider
   * holding any other token keeps it. A token's account must be a member of
   * a provider's space to replace its token: a provider's reconnect with
   * another account's token (a member of none of the Spaces that held the
   * replaced token) is refused (`other-account`), or every task of those
   * Spaces would read as no longer assigned to me.
   *
   * `sameAccountTokens` are further tokens proven to be this account's on this
   * host (see {@link findAccountTokens}); providers holding them get the new
   * one too.
   */
  async connect(
    token: string,
    host: string = DEFAULT_HOST,
    replacedToken?: string | null,
    sameAccountTokens: readonly string[] = [],
  ): Promise<PlainspaceConnectResult> {
    const logoutVersion = this._logoutVersion;
    const previous = this._account();
    const res = await firstValueFrom(
      this._api.verifyToken$({ ...DEFAULT_PLAINSPACE_CFG, host, token }),
    );
    if (res.status !== 'ok') {
      return res.status;
    }
    // A late response must not restore an account after an explicit disconnect.
    if (logoutVersion !== this._logoutVersion) {
      return 'aborted';
    }
    // A provider without a space lists all of mine (see matchesSpace).
    const memberSpaces = new Set(res.me.projects.flatMap((p) => [p.id, p.slug]));
    const isMember = (ip: IssueProviderPlainspace): boolean =>
      !ip.spaceId || memberSpaces.has(ip.spaceId);
    const providers = (
      await firstValueFrom(this._store.select(selectAllIssueProviders))
    ).filter((ip): ip is IssueProviderPlainspace => ip.issueProviderKey === 'PLAINSPACE');
    // Refused only when none of the providers holding it is a member: one
    // account may share several Spaces on one token and have left one of
    // them; only the member ones are updated below.
    const reconnected = providers.filter(
      (ip) => !!replacedToken && ip.token === replacedToken,
    );
    if (reconnected.length && !reconnected.some(isMember)) {
      // Replacing the key already revoked these tokens of the new token's own
      // account: their providers still get it, or they would break too.
      this._replaceProviderTokens(providers.filter(isMember), sameAccountTokens, token);
      return 'other-account';
    }
    const account: PlainspaceAccount = { host, token, email: res.me.email };
    // The previous account's token only stands for this one if it is the same
    // person on the same host; "Use a different token" may switch accounts,
    // and the same email on another host is a different account.
    const isSameAccount =
      previous?.email === account.email && previous?.host === account.host;
    // Reconnecting one provider of another account (another host, or another
    // email on the same host) must not replace this device's saved account,
    // used by "Collaborate on Plainspace": its token is still valid.
    const isOtherAccountReconnect = !!replacedToken && !!previous && !isSameAccount;
    if (!isOtherAccountReconnect) {
      this._account.set(account);
      this._save(account);
    }
    this._replaceProviderTokens(
      providers.filter(isMember),
      [replacedToken, isSameAccount ? previous?.token : null, ...sameAccountTokens],
      token,
    );
    return 'ok';
  }

  /**
   * The tokens this device holds (its account and its Plainspace providers)
   * that still belong to `email` on `host`. Called before replacing the
   * account's active key, while it still answers: one account has one active
   * key, so this finds the key the replacement revokes, and the providers
   * holding it, also synced from other devices, can get the new one (#8616).
   */
  async findAccountTokens(host: string, email: string): Promise<string[]> {
    const providers = await firstValueFrom(this._store.select(selectAllIssueProviders));
    const account = this._account();
    const candidates = new Set(
      [
        account?.host === host ? account.token : null,
        ...providers
          .filter(
            (ip): ip is IssueProviderPlainspace => ip.issueProviderKey === 'PLAINSPACE',
          )
          .filter((ip) => ip.host === host)
          .map((ip) => ip.token),
      ].filter((t): t is string => !!t),
    );
    const wanted = email.trim().toLowerCase();
    const checks = await Promise.all(
      [...candidates].map(async (token) => {
        const res = await firstValueFrom(
          this._api.verifyToken$({ ...DEFAULT_PLAINSPACE_CFG, host, token }),
        );
        return res.status === 'ok' && res.me.email.toLowerCase() === wanted
          ? token
          : null;
      }),
    );
    return checks.filter((t): t is string => !!t);
  }

  logout(): void {
    this._logoutVersion++;
    this._account.set(null);
    localStorage.removeItem(LS.PLAINSPACE_ACCOUNT);
  }

  /** One `updateIssueProvider` op per provider that held a replaced token. */
  private _replaceProviderTokens(
    providers: IssueProviderPlainspace[],
    replacedTokens: readonly (string | null | undefined)[],
    newToken: string,
  ): void {
    const oldTokens = replacedTokens.filter((t): t is string => !!t && t !== newToken);
    if (!oldTokens.length) {
      return;
    }
    const ids = providers
      .filter((ip) => !!ip.token && oldTokens.includes(ip.token))
      .map((ip) => ip.id);
    for (const id of ids) {
      this._store.dispatch(
        IssueProviderActions.updateIssueProvider({
          issueProvider: { id, changes: { token: newToken } },
        }),
      );
    }
    this._connectionState.replaceTokens(ids, oldTokens);
    Log.log('Plainspace: replaced provider token', { providerIds: ids });
  }

  private _load(): PlainspaceAccount | null {
    const raw = localStorage.getItem(LS.PLAINSPACE_ACCOUNT);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as PlainspaceAccount;
    } catch {
      Log.err('Plainspace: failed to parse stored account');
      return null;
    }
  }

  private _save(account: PlainspaceAccount): void {
    localStorage.setItem(LS.PLAINSPACE_ACCOUNT, JSON.stringify(account));
  }
}
