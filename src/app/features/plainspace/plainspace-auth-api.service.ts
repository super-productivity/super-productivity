import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Log } from '../../core/log';

/**
 * Plainspace's email-code sign-in (`{host}/api/auth/…`, `/api/projects`), the
 * same endpoints its `/connect/super-productivity` page calls, so SP can get a
 * personal API token without the browser hop. The server sends CORS for all
 * origins, so web, Electron and Android call it directly.
 *
 * Every method fails soft into a status the connect dialog can show. Only
 * statuses are logged: never the email, the code or a token (rule 9).
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceAuthApiService {
  private _http = inject(HttpClient);

  /**
   * Emails a 6-digit code. A 404 means the host has no such endpoint (an older
   * or unknown self-hosted server): the dialog falls back to the browser.
   */
  requestCode$(host: string, email: string): Observable<PlainspaceCodeRequestResult> {
    return this._http
      .post<unknown>(`${apiBase(host)}/auth/request-creation-code`, { email })
      .pipe(
        map((): PlainspaceCodeRequestResult => ({ status: 'sent' })),
        catchError((err: unknown) => {
          const status = toStatus(err, 'request code');
          return of<PlainspaceCodeRequestResult>(
            status === 404
              ? { status: 'unsupported' }
              : status === 422
                ? { status: 'invalid-email' }
                : failure(status),
          );
        }),
      );
  }

  /**
   * Trades email + code for an account-wide API token. `already-connected`
   * leaves the code unused, so a follow-up call with `force` can replace the
   * active key; so does `no-account`, for {@link createSpace$}.
   */
  connect$(
    host: string,
    email: string,
    code: string,
    force = false,
  ): Observable<PlainspaceConnectCodeResult> {
    return this._http
      .post<unknown>(`${apiBase(host)}/auth/connect`, {
        email,
        code,
        ...(force ? { force: true } : {}),
      })
      .pipe(
        map((res): PlainspaceConnectCodeResult => {
          if (isRecord(res) && res['status'] === 'connected') {
            if (typeof res['token'] === 'string' && res['token']) {
              return { status: 'connected', token: res['token'] };
            }
          } else if (isRecord(res) && res['status'] === 'already-connected') {
            const apiToken = isRecord(res['apiToken']) ? res['apiToken'] : {};
            return {
              status: 'already-connected',
              createdAt: stringOrNull(apiToken['createdAt']),
              lastUsedAt: stringOrNull(apiToken['lastUsedAt']),
            };
          }
          Log.err('Plainspace: connect got an unexpected answer');
          return { status: 'unreachable' };
        }),
        catchError((err: unknown) => {
          const status = toStatus(err, 'connect');
          // Only the machine discriminator means "no account": any other 404
          // would create a duplicate Space.
          if (
            status === 404 &&
            err instanceof HttpErrorResponse &&
            isRecord(err.error) &&
            err.error['code'] === 'no-account'
          ) {
            return of<PlainspaceConnectCodeResult>({ status: 'no-account' });
          }
          return of<PlainspaceConnectCodeResult>(
            status === 401 ? { status: 'invalid-code' } : failure(status),
          );
        }),
      );
  }

  /**
   * A brand-new account: creates its first Space with the code `connect$`
   * left unused, then mints the API token with that Space's member session,
   * as Plainspace's own connect page does.
   */
  createSpace$(
    host: string,
    data: { name: string; displayName: string; email: string; code: string },
  ): Observable<PlainspaceCreateSpaceResult> {
    return this._http.post<unknown>(`${apiBase(host)}/projects`, data).pipe(
      map((res): PlainspaceCreatedSpace | null => {
        const project = isRecord(res) && isRecord(res['project']) ? res['project'] : null;
        return isRecord(res) &&
          typeof res['token'] === 'string' &&
          typeof project?.['id'] === 'string' &&
          typeof project['slug'] === 'string'
          ? { id: project['id'], slug: project['slug'], memberToken: res['token'] }
          : null;
      }),
      map((space): PlainspaceCreateSpaceResult => {
        if (space) {
          return { status: 'created', space };
        }
        Log.err('Plainspace: create space got an unexpected answer');
        return { status: 'unreachable' };
      }),
      catchError((err: unknown) => {
        const status = toStatus(err, 'create space');
        return of<PlainspaceCreateSpaceResult>(
          status === 401 ? { status: 'invalid-code' } : failure(status),
        );
      }),
    );
  }

  /** Mints the account-wide API token with a member session of one Space. */
  createApiToken$(
    host: string,
    space: PlainspaceCreatedSpace,
  ): Observable<string | null> {
    return this._http
      .post<unknown>(
        `${apiBase(host)}/projects/${encodeURIComponent(space.slug)}/auth/api-tokens`,
        {},
        { headers: new HttpHeaders({ Authorization: `Bearer ${space.memberToken}` }) },
      )
      .pipe(
        map((res) =>
          isRecord(res) && typeof res['token'] === 'string' && res['token']
            ? res['token']
            : null,
        ),
        catchError((err: unknown) => {
          toStatus(err, 'create api token');
          return of(null);
        }),
      );
  }
}

/**
 * Failures every endpoint shares: `unreachable` is no answer (offline, 5xx),
 * `failed` any other refusal.
 */
export type PlainspaceAuthFailure =
  | { status: 'rate-limited' }
  | { status: 'unreachable' }
  | { status: 'failed' };

export type PlainspaceCodeRequestResult =
  | { status: 'sent' }
  | { status: 'unsupported' }
  | { status: 'invalid-email' }
  | PlainspaceAuthFailure;

export type PlainspaceConnectCodeResult =
  | { status: 'connected'; token: string }
  /** A key is active elsewhere; when it was created and last used. */
  | { status: 'already-connected'; createdAt: string | null; lastUsedAt: string | null }
  | { status: 'no-account' }
  | { status: 'invalid-code' }
  | PlainspaceAuthFailure;

export interface PlainspaceCreatedSpace {
  id: string;
  slug: string;
  /** The creator's member session, only used to mint the API token. */
  memberToken: string;
}

export type PlainspaceCreateSpaceResult =
  | { status: 'created'; space: PlainspaceCreatedSpace }
  | { status: 'invalid-code' }
  | PlainspaceAuthFailure;

const apiBase = (host: string): string => `${host.replace(/\/+$/, '')}/api`;

const toStatus = (err: unknown, what: string): number => {
  const status = err instanceof HttpErrorResponse ? err.status : 0;
  Log.err(`Plainspace: ${what} failed`, { status });
  return status;
};

const failure = (status: number): PlainspaceAuthFailure =>
  status === 429
    ? { status: 'rate-limited' }
    : status === 0 || status >= 500
      ? { status: 'unreachable' }
      : { status: 'failed' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
