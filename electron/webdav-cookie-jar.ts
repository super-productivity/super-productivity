import { createHash } from 'crypto';

/**
 * In-memory session cookies for WebDAV sync requests (#10839).
 *
 * The main window strips `Cookie` from every renderer request, and renderer
 * `fetch` can neither read `Set-Cookie` nor send cross-origin cookies. A server
 * that tracks an authorized session by cookie (pCloud) therefore saw each sync
 * as a fresh login and emailed the user a security alert every time.
 *
 * Process lifetime only: never persisted, never logged. An origin's cookies are
 * dropped when its credentials change: Nextcloud accepts a DAV session cookie
 * without checking the Basic credentials, so a stale cookie would otherwise
 * keep syncing into the previous account.
 *
 * shortcut: keyed by origin, ignoring Domain/Path — one WebDAV account per
 * origin is the only shape we sync with; parse those attributes if a server
 * scopes cookies to sub-paths.
 */
export interface WebDavCookieJar {
  /**
   * Registers `url`'s origin as a WebDAV server and returns the `Cookie`
   * header value to send, if that server set any cookies for these
   * `authorization` credentials.
   */
  beginRequest(url: string, authorization?: string): string | undefined;
  /** Stores `Set-Cookie` values for origins registered by `beginRequest`. */
  storeFromResponse(url: string, responseHeaders: Record<string, string[]>): void;
}

interface StoredCookie {
  value: string;
  expiresAt: number;
}

interface ParsedCookie extends StoredCookie {
  name: string;
}

interface OriginSession {
  credentialsHash: string;
  cookies: Map<string, StoredCookie>;
}

// Hashed so the jar holds no second copy of the credentials.
const hashCredentials = (authorization = ''): string =>
  createHash('sha256').update(authorization).digest('hex');

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    // Unparseable URLs carry no origin to key cookies by; skip them.
    return undefined;
  }
};

const readExpiry = (attributes: string[], now: number): number => {
  let expires: number | undefined;
  for (const attribute of attributes) {
    const eq = attribute.indexOf('=');
    const key = (eq < 0 ? attribute : attribute.slice(0, eq)).trim().toLowerCase();
    const value = eq < 0 ? '' : attribute.slice(eq + 1).trim();
    // Max-Age wins over Expires (RFC 6265 §5.3).
    if (key === 'max-age' && /^-?\d+$/.test(value)) {
      const maxAgeMs = Number(value) * 1000;
      return now + maxAgeMs;
    }
    if (key === 'expires' && !Number.isNaN(Date.parse(value))) {
      expires = Date.parse(value);
    }
  }
  return expires ?? Infinity;
};

const parseSetCookie = (raw: string, now: number): ParsedCookie | undefined => {
  const [pair, ...attributes] = raw.split(';');
  const eq = pair.indexOf('=');
  const name = eq < 0 ? '' : pair.slice(0, eq).trim();
  if (!name) {
    return undefined;
  }
  return {
    name,
    value: pair.slice(eq + 1).trim(),
    expiresAt: readExpiry(attributes, now),
  };
};

const setCookieValues = (headers: Record<string, string[]>): string[] =>
  Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === 'set-cookie')
    .flatMap(([, values]) => values);

/** Creates an empty jar; the main window holds one for its session. */
export const createWebDavCookieJar = (): WebDavCookieJar => {
  const sessionsByOrigin = new Map<string, OriginSession>();

  return {
    beginRequest: (url, authorization) => {
      const origin = originOf(url);
      if (!origin) {
        return undefined;
      }
      const credentialsHash = hashCredentials(authorization);
      if (sessionsByOrigin.get(origin)?.credentialsHash !== credentialsHash) {
        sessionsByOrigin.set(origin, { credentialsHash, cookies: new Map() });
      }
      const { cookies } = sessionsByOrigin.get(origin)!;
      const now = Date.now();
      const pairs: string[] = [];
      for (const [name, cookie] of cookies) {
        if (cookie.expiresAt <= now) {
          cookies.delete(name);
        } else {
          pairs.push(`${name}=${cookie.value}`);
        }
      }
      return pairs.length > 0 ? pairs.join('; ') : undefined;
    },

    storeFromResponse: (url, responseHeaders) => {
      const origin = originOf(url);
      const cookies = origin ? sessionsByOrigin.get(origin)?.cookies : undefined;
      if (!cookies) {
        return;
      }
      const now = Date.now();
      for (const raw of setCookieValues(responseHeaders)) {
        const cookie = parseSetCookie(raw, now);
        if (!cookie) {
          continue;
        }
        if (cookie.expiresAt <= now) {
          cookies.delete(cookie.name);
        } else {
          cookies.set(cookie.name, { value: cookie.value, expiresAt: cookie.expiresAt });
        }
      }
    },
  };
};
