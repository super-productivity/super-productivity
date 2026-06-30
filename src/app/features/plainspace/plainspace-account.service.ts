import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LS } from '../../core/persistence/storage-keys.const';
import { Log } from '../../core/log';
import { PlainspaceAccount } from './plainspace-account.model';
import { PlainspaceApiService } from '../issue/providers/plainspace/plainspace-api.service';
import { DEFAULT_PLAINSPACE_CFG } from '../issue/providers/plainspace/plainspace-cfg-form.const';

const DEFAULT_HOST = 'https://plainspace.org';

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
  private readonly _account = signal<PlainspaceAccount | null>(this._load());

  readonly account = this._account.asReadonly();
  readonly isLoggedIn = computed(() => !!this._account());
  readonly token = computed(() => this._account()?.token ?? null);
  readonly host = computed(() => this._account()?.host ?? null);

  /**
   * Validates a PAT against the host (`GET /api/integration/me`) and, on
   * success, stores it. Returns whether the token was accepted.
   */
  async connect(token: string, host: string = DEFAULT_HOST): Promise<boolean> {
    const me = await firstValueFrom(
      this._api.getMe$({ ...DEFAULT_PLAINSPACE_CFG, host, token }),
    );
    if (!me) {
      return false;
    }
    const account: PlainspaceAccount = { host, token, email: me.email };
    this._account.set(account);
    this._save(account);
    return true;
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
