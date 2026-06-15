import { Injectable, computed, signal } from '@angular/core';
import { nanoid } from 'nanoid';
import { LS } from '../../core/persistence/storage-keys.const';
import { Log } from '../../core/log';
import { PlainspaceAccount } from './plainspace-account.model';
import { PLAINSPACE_MOCK_CURRENT_USER_ID } from './plainspace-identity.const';

const DEFAULT_HOST = 'https://plainspace.org';

/**
 * Holds the signed-in Plainspace identity and exposes it as signals so the rest
 * of the app can react to login/logout. Persisted to localStorage (local-only,
 * never synced — identity is per device).
 *
 * The `login` here is a mock: a real implementation would perform a token
 * exchange (or OAuth redirect via src/app/plugins/oauth) and read the user id
 * from Plainspace. The prototype mints a token and uses the fixed mock identity
 * so the assigned/unassigned split lines up with the mock space data.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceAccountService {
  private readonly _account = signal<PlainspaceAccount | null>(this._load());

  readonly account = this._account.asReadonly();
  readonly isLoggedIn = computed(() => !!this._account());
  readonly currentUserId = computed(() => this._account()?.userId ?? null);

  login(displayName: string, host: string = DEFAULT_HOST): PlainspaceAccount {
    const account: PlainspaceAccount = {
      host,
      userId: PLAINSPACE_MOCK_CURRENT_USER_ID,
      displayName: displayName.trim() || 'Me',
      token: `mock-token-${nanoid()}`,
    };
    this._account.set(account);
    this._save(account);
    return account;
  }

  logout(): void {
    this._account.set(null);
    localStorage.removeItem(LS.PLAINSPACE_ACCOUNT);
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
