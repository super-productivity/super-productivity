import { Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

/**
 * Which Plainspace providers had their token rejected (401) on the last
 * request, so the issue panel can ask the user to reconnect, and which run on a
 * server too old to take a title or a scheduled time. In memory only — never persisted or synced:
 * the next successful poll clears a rejection, and a restart starts clean.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceConnectionStateService {
  private readonly _rejectedProviderIds = signal<ReadonlySet<string>>(new Set());
  private readonly _serverTooOldProviderIds = signal<ReadonlySet<string>>(new Set());
  /**
   * Provider + token pairs a reconnect replaced: requests made with them may
   * still answer. Per provider, as a provider a reconnect skipped keeps the
   * old token and must still show its rejection.
   */
  private readonly _replacedTokens = new Set<string>();

  readonly rejectedProviderIds = this._rejectedProviderIds.asReadonly();
  readonly serverTooOldProviderIds = this._serverTooOldProviderIds.asReadonly();

  /**
   * The provider's server refused or ignored a title or a scheduled time (a
   * server from before the integration PATCH took them; both arrived
   * together). Neither is pushed to it for this session; done keeps syncing.
   * An upgraded server is picked up after a restart.
   */
  reportServerTooOld(providerId: string): void {
    if (!this._serverTooOldProviderIds().has(providerId)) {
      this._serverTooOldProviderIds.update((ids) => new Set(ids).add(providerId));
    }
  }

  isServerTooOld(providerId: string): boolean {
    return this._serverTooOldProviderIds().has(providerId);
  }

  /** A request for this provider succeeded: its token works. */
  reportSuccess(providerId: string): void {
    this.clear([providerId]);
  }

  /**
   * A request for this provider failed. Only a rejected token changes the
   * state; offline and server errors say nothing about the token, and neither
   * does a late answer to a request made with a token a reconnect replaced.
   */
  reportError(providerId: string, err: unknown, usedToken?: string | null): void {
    if (usedToken && this._replacedTokens.has(`${providerId}\n${usedToken}`)) {
      return;
    }
    if (isPlainspaceAuthError(err) && !this._rejectedProviderIds().has(providerId)) {
      this._rejectedProviderIds.update((ids) => new Set(ids).add(providerId));
    }
  }

  /** A reconnect gave these providers a new token in place of `oldTokens`. */
  replaceTokens(providerIds: string[], oldTokens: string[]): void {
    providerIds.forEach((id) =>
      oldTokens.forEach((t) => this._replacedTokens.add(`${id}\n${t}`)),
    );
    this.clear(providerIds);
  }

  clear(providerIds: string[]): void {
    if (!providerIds.some((id) => this._rejectedProviderIds().has(id))) {
      return;
    }
    this._rejectedProviderIds.update((ids) => {
      const next = new Set(ids);
      providerIds.forEach((id) => next.delete(id));
      return next;
    });
  }
}

/**
 * Plainspace gave a verdict on the token: it is revoked, expired or wrong. The
 * integration API answers a bad token with 401 only; a 403 comes from a proxy
 * or firewall in between, which reconnecting can't fix.
 */
export const isPlainspaceAuthError = (err: unknown): boolean =>
  err instanceof HttpErrorResponse && err.status === 401;

/**
 * A poll failure that warrants no message: no answer (offline, DNS, TLS,
 * timeout), a server-side failure, or a refused request (401 shows "reconnect"
 * in the issue panel instead; 403 is a proxy in the way). The next poll retries.
 */
export const isPlainspaceQuietPollError = (err: unknown): boolean =>
  err instanceof HttpErrorResponse &&
  (err.status === 0 || err.status >= 500 || err.status === 401 || err.status === 403);
