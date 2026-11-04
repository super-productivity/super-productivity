import { APP_WEB_FETCH } from '../../../op-log/sync-providers/platform/app-web-fetch';
import { SyncLog } from '../../../core/log';

/**
 * Browser sign-in of a new device against a SuperSync server
 * (`packages/super-sync-server/src/connect/`): the app creates a request, the
 * user approves it in the browser, and the app's next poll receives a normal
 * account token, once.
 */

export type ConnectPlatform = 'android' | 'ios' | 'mac' | 'windows' | 'linux' | 'web';

export interface ConnectRequest {
  requestId: string;
  pollSecret: string;
  matchCode: string;
  pollIntervalMs: number;
}

export type ConnectPollAnswer =
  | { status: 'pending' | 'denied' | 'expired' }
  | { status: 'approved'; token: string }
  | { status: 'slow-down'; retryAfterMs: number };

export type SignInOutcome =
  | { kind: 'approved'; token: string }
  | { kind: 'denied' | 'expired' | 'cancelled' };

/** The server can't sign in from the app (older or own server): set up by hand. */
export class ConnectUnsupportedError extends Error {
  override name = 'ConnectUnsupportedError';
}

// The server's pattern; the id goes into a URL.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const MAX_POLL_DELAY_MS = 60_000;
// Requests live 10 minutes and the server's 'expired' answer normally ends the
// wait first; this bound only matters while the server can't be reached. Not
// taken from the server's expiresAt, because device clocks drift.
export const MAX_SIGN_IN_WAIT_MS = 11 * 60 * 1000;

/** The page the browser opens; the server's index page has a Connect mode. */
export const connectLink = (baseUrl: string, requestId: string): string =>
  `${baseUrl}/?r=${requestId}`;

const postJson = (url: string, body: object): Promise<Response> =>
  APP_WEB_FETCH()(url, {
    method: 'POST',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const clampDelay = (ms: number): number =>
  Math.min(MAX_POLL_DELAY_MS, Math.max(1000, ms));

const parseConnectRequest = (body: unknown): ConnectRequest => {
  const b = (body ?? {}) as Record<string, unknown>;
  if (
    typeof b.requestId !== 'string' ||
    !REQUEST_ID_PATTERN.test(b.requestId) ||
    typeof b.pollSecret !== 'string' ||
    typeof b.matchCode !== 'string'
  ) {
    throw new ConnectUnsupportedError('Unexpected sign-in answer');
  }
  const interval = typeof b.pollIntervalMs === 'number' ? b.pollIntervalMs : NaN;
  return {
    requestId: b.requestId,
    pollSecret: b.pollSecret,
    matchCode: b.matchCode,
    pollIntervalMs: clampDelay(
      Number.isFinite(interval) ? interval : DEFAULT_POLL_INTERVAL_MS,
    ),
  };
};

export const createConnectRequest = async (
  baseUrl: string,
  device: { deviceName: string; platform: ConnectPlatform },
): Promise<ConnectRequest> => {
  const res = await postJson(`${baseUrl}/api/connect/requests`, device);
  // 404: the server predates browser sign-in. 5xx: it was updated without its
  // database migration. Manual setup works on both.
  if (res.status === 404 || res.status >= 500) {
    throw new ConnectUnsupportedError(`HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`Sign-in request failed: HTTP ${res.status}`);
  }
  // A proxy or another app at that address may answer with HTML.
  return parseConnectRequest(await res.json().catch(() => null));
};

const parsePollAnswer = (body: unknown): ConnectPollAnswer => {
  const { status, token } = (body ?? {}) as { status?: unknown; token?: unknown };
  if (status === 'approved' && typeof token === 'string' && token) {
    return { status, token };
  }
  if (status === 'pending' || status === 'denied' || status === 'expired') {
    return { status };
  }
  throw new Error('Unexpected sign-in poll answer');
};

/** Seconds from a Retry-After header; 0 when missing (a browser hides it without CORS exposure). */
const retryAfterMs = (header: string | null): number => {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

export const pollConnectRequest = async (
  baseUrl: string,
  request: ConnectRequest,
): Promise<ConnectPollAnswer> => {
  const res = await postJson(
    `${baseUrl}/api/connect/requests/${request.requestId}/poll`,
    {
      pollSecret: request.pollSecret,
    },
  );
  if (res.status === 429) {
    return {
      status: 'slow-down',
      retryAfterMs: retryAfterMs(res.headers.get('Retry-After')),
    };
  }
  if (!res.ok) {
    throw new Error(`Sign-in poll failed: HTTP ${res.status}`);
  }
  return parsePollAnswer(await res.json());
};

export interface PollLoopDeps {
  poll: () => Promise<ConnectPollAnswer>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  isCancelled: () => boolean;
}

// A dropped connection or a server hiccup must not end a sign-in the user is
// still finishing in the browser; the next poll simply tries again.
const keepWaiting = (e: unknown): ConnectPollAnswer => {
  SyncLog.warn('SuperSync sign-in poll failed, trying again', {
    name: e instanceof Error ? e.name : typeof e,
  });
  return { status: 'pending' };
};

/** Polls until the browser approves, denies or the request runs out. */
export const waitForApproval = async (
  pollIntervalMs: number,
  deps: PollLoopDeps,
): Promise<SignInOutcome> => {
  const deadline = deps.now() + MAX_SIGN_IN_WAIT_MS;
  let delayMs = pollIntervalMs;
  while (deps.now() < deadline) {
    await deps.wait(delayMs);
    if (deps.isCancelled()) return { kind: 'cancelled' };
    const answer = await deps.poll().catch(keepWaiting);
    // A claimed token after Cancel stays unused; it is stored nowhere.
    if (deps.isCancelled()) return { kind: 'cancelled' };
    if (answer.status === 'approved') return { kind: 'approved', token: answer.token };
    if (answer.status === 'denied' || answer.status === 'expired') {
      return { kind: answer.status };
    }
    delayMs =
      answer.status === 'slow-down'
        ? clampDelay(Math.max(answer.retryAfterMs, delayMs * 2))
        : pollIntervalMs;
  }
  return { kind: 'expired' };
};
