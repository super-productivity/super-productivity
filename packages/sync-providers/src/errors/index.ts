import { extractErrorMessage as extractGenericErrorMessage } from '@sp/sync-core';

/**
 * Best-effort extraction of a meaningful message string from an unknown
 * thrown value, with one Super-Productivity-specific rewrite: zlib `Z_*`
 * error codes get translated into a human-readable "compression error: …"
 * form. Used as the message-derivation entry point for the privacy-safe
 * error classes below.
 */
export const extractErrorMessage = (err: unknown): string | null => {
  const message = extractGenericErrorMessage(err);
  if (typeof message === 'string' && message.startsWith('Z_')) {
    return `Compression error: ${message.replace('Z_', '').replace(/_/g, ' ').toLowerCase()}`;
  }
  return message;
};

/**
 * Base class for provider error types that need to retain a raw payload
 * for catch-site diagnostics (`.additionalLog`). Unlike the previous
 * app-side base class, this one does NOT log on construction — privacy
 * audits depend on every log path going through an injected
 * `SyncLogger`, never through error-constructor side effects.
 *
 * Callers must NEVER pass `additionalLog` directly into a logger; it
 * may contain raw user data. Use `toSyncLogError(err)` plus a
 * hand-curated meta object instead.
 */
export class AdditionalLogErrorBase<T = unknown[]> extends Error {
  additionalLog: T;

  constructor(...additional: unknown[]) {
    const extractedMessage = extractErrorMessage(additional[0]);
    super(extractedMessage ?? 'Unknown error');
    this.additionalLog = additional as T;
  }
}

// --------------API ERRORS--------------

export class NoRevAPIError extends AdditionalLogErrorBase {
  override name = ' NoRevAPIError';
}

export class TooManyRequestsAPIError extends AdditionalLogErrorBase<{
  status: number;
  retryAfter?: number;
  path?: string;
}> {
  override name = ' TooManyRequestsAPIError';
  readonly status: number;
  readonly retryAfter?: number;
  readonly path?: string;

  constructor(info: { status: number; retryAfter?: number; path?: string }) {
    super(`HTTP ${info.status} too many requests`);
    this.status = info.status;
    this.retryAfter = info.retryAfter;
    this.path = info.path;
    this.additionalLog = info;
  }
}

export class RemoteFileNotFoundAPIError extends AdditionalLogErrorBase {
  override name = ' RemoteFileNotFoundAPIError';
}

export class MissingRefreshTokenAPIError extends Error {
  override name = ' MissingRefreshTokenAPIError';
}

export class UploadRevToMatchMismatchAPIError extends AdditionalLogErrorBase {
  override name = ' UploadRevToMatchMismatchAP';
}

export class HttpNotOkAPIError extends AdditionalLogErrorBase {
  override name = ' HttpNotOkAPIError';
  /**
   * Raw `Response` object retained so callers can read `.status` /
   * `.statusText`.
   *
   * **Privacy invariant: never log `response.body` (the body stream) or
   * stream it into a structured logger.** It can contain user filenames
   * (PROPFIND multistatus) and other content. The `detail` field below is
   * the only sanctioned surface for body content, and that one is
   * UI-only — see its JSDoc.
   */
  response: Response;
  body?: string;
  /**
   * Parsed error excerpt from the body (max 300 chars). Kept separate
   * from `.message` so privacy-aware log paths default to logging only
   * `HTTP <status> <statusText>`; UI surfaces opt in to the longer
   * detail via `getErrorTxt`.
   *
   * **Privacy invariant: route `detail` to user-facing UI only. Never
   * pass it to `SyncLog` / structured logger meta** — Nextcloud's
   * `<s:message>` content (the typical source) often includes the
   * requested resource filename.
   */
  detail?: string;

  constructor(response: Response, body?: string) {
    super(response, body);
    this.response = response;
    this.body = body;
    const statusText = response.statusText || 'Unknown Status';

    if (body) {
      const safeBody =
        typeof body === 'string'
          ? body
          : (() => {
              try {
                return JSON.stringify(body);
              } catch {
                return String(body);
              }
            })();
      const parsed = HttpNotOkAPIError._extractErrorFromBody(safeBody);
      if (parsed) {
        this.detail = parsed;
      }
    }

    this.message = `HTTP ${response.status} ${statusText}`;
  }

  private static _extractErrorFromBody(body: string): string {
    if (!body) return '';
    const maxBodyLength = 300;

    const nextcloudMessageMatch = body.match(/<s:message[^>]*>(.*?)<\/s:message>/i);
    if (nextcloudMessageMatch && nextcloudMessageMatch[1]) {
      return nextcloudMessageMatch[1].trim().substring(0, maxBodyLength);
    }

    const webdavErrorMatch = body.match(/<d:error[^>]*>(.*?)<\/d:error>/i);
    if (webdavErrorMatch && webdavErrorMatch[1]) {
      return webdavErrorMatch[1].trim().substring(0, maxBodyLength);
    }

    const titleMatch = body.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].trim();
      if (title && !title.match(/^(error|404|403|500)$/i)) {
        return title.substring(0, maxBodyLength);
      }
    }

    try {
      const jsonMatch = body.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.error) {
          return String(parsed.error).substring(0, maxBodyLength);
        }
        if (parsed.message) {
          return String(parsed.message).substring(0, maxBodyLength);
        }
      }
    } catch {
      // Not JSON, continue
    }

    let cleanBody = body;
    let previousBody: string;
    do {
      previousBody = cleanBody;
      cleanBody = cleanBody
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gim, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gim, '')
        .replace(/<script\b/gim, '')
        .replace(/<style\b/gim, '');
    } while (cleanBody !== previousBody);

    const withoutTags = cleanBody
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return withoutTags.substring(0, maxBodyLength);
  }
}

export class PotentialCorsError extends AdditionalLogErrorBase {
  override name = 'PotentialCorsError';
  url: string;

  constructor(url: string, ...args: unknown[]) {
    super(
      `Cross-Origin Request Blocked: The request to ${url} was blocked by CORS policy`,
      ...args,
    );
    this.url = url;
  }
}

// --------------SYNC PROVIDER ERRORS--------------

export class MissingCredentialsSPError extends Error {
  override name = 'MissingCredentialsSPError';
}

export class AuthFailSPError extends AdditionalLogErrorBase {
  override name = 'AuthFailSPError';
}

export class InvalidDataSPError extends AdditionalLogErrorBase {
  override name = 'InvalidDataSPError';
}

export class EmptyRemoteBodySPError extends InvalidDataSPError {
  override name = 'EmptyRemoteBodySPError';
}

export class RemoteFileChangedUnexpectedly extends AdditionalLogErrorBase {
  override name = 'RemoteFileChangedUnexpectedly';
}
