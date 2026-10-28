import { isIPv6 } from 'net';
import {
  CAPTURE_MAX_CREATES_PER_GRANT_PER_DAY,
  CAPTURE_MCP_AUTH_FAILURES_PER_MINUTE,
  CAPTURE_MCP_CALLS_PER_MINUTE,
} from './capture.const';

/**
 * Limits for /mcp. The global per-IP limiter is off for /mcp because
 * assistant vendors share egress IPs across all users, so authenticated
 * calls count per grant, and only failed auths count per IP (an IPv6 /64
 * counts as one IP). A grant that authenticated recently is never blocked by
 * its IP, so failed auths of others behind the same egress cannot lock it out.
 *
 * shortcut: in-process counters, single SuperSync instance (helm max 1).
 */

const WINDOW_MS = 60_000;
/** Pruned at most once per window and only above this size, so it stays linear. */
const PRUNE_ABOVE = 1000;
const counters = new Map<string, { count: number; resetAt: number }>();
let nextPruneAt = 0;

const RECENT_GRANT_MS = 24 * 60 * 60 * 1000;
const RECENT_GRANTS_MAX = 10_000;
/** Grant id → until when it counts as recently authenticated. Insertion-ordered. */
const recentGrants = new Map<string, number>();

const isOverLimit = (key: string, max: number, now: number): boolean => {
  const counter = counters.get(key);
  return !!counter && now < counter.resetAt && counter.count >= max;
};

const count = (key: string, now: number, windowMs: number = WINDOW_MS): void => {
  const counter = counters.get(key);
  if (counter && now < counter.resetAt) {
    counter.count++;
    return;
  }
  if (counters.size > PRUNE_ABOVE && now >= nextPruneAt) {
    nextPruneAt = now + WINDOW_MS;
    for (const [k, c] of counters) if (now >= c.resetAt) counters.delete(k);
  }
  counters.set(key, { count: 1, resetAt: now + windowMs });
};

/** Fixed one-minute window per grant; counts every authenticated /mcp call. */
export const isGrantRateLimited = (
  grantId: string,
  now: number = Date.now(),
): boolean => {
  const key = `grant:${grantId}`;
  if (isOverLimit(key, CAPTURE_MCP_CALLS_PER_MINUTE, now)) return true;
  count(key, now);
  return false;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed one-day window per grant; counts only tasks actually queued. */
export const isGrantDailyCapReached = (
  grantId: string,
  now: number = Date.now(),
): boolean => isOverLimit(`day:${grantId}`, CAPTURE_MAX_CREATES_PER_GRANT_PER_DAY, now);

export const recordGrantCreate = (grantId: string, now: number = Date.now()): void =>
  count(`day:${grantId}`, now, DAY_MS);

/**
 * One rotating IPv6 host must not get a fresh limit per address, and an
 * IPv4-mapped address (`::ffff:a.b.c.d`, in any spelling) is its IPv4 address.
 */
export const ipLimitKey = (ip: string): string => {
  if (!isIPv6(ip)) return `ip:${ip}`;
  const [head, tail] = ip.split('%')[0].toLowerCase().split('::');
  const toGroups = (part: string | undefined): string[] =>
    part
      ? part.split(':').flatMap((g) => {
          if (!g.includes('.')) return [g];
          // An embedded IPv4 tail fills the last two groups.
          const [a, b, c, d] = g.split('.').map(Number);
          return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
        })
      : [];
  const headGroups = toGroups(head);
  const tailGroups = toGroups(tail);
  const groups = (
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'),
          ...tailGroups,
        ]
  ).map((g) => parseInt(g, 16));
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `ip:${[groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')}`;
  }
  return `ip:${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
};

const isRecentGrant = (grantId: string | null, now: number): boolean => {
  if (!grantId) return false;
  const until = recentGrants.get(grantId);
  return until !== undefined && now < until;
};

/**
 * Checked before auth, so a flood of bad tokens costs no DB lookup. A
 * recently authenticated grant id passes; its failures count per grant.
 */
export const isAuthFailureLimited = (
  ip: string,
  grantId: string | null,
  now: number = Date.now(),
): boolean =>
  isRecentGrant(grantId, now)
    ? isOverLimit(`fail:${grantId}`, CAPTURE_MCP_AUTH_FAILURES_PER_MINUTE, now)
    : isOverLimit(ipLimitKey(ip), CAPTURE_MCP_AUTH_FAILURES_PER_MINUTE, now);

export const recordAuthFailure = (
  ip: string,
  grantId: string | null,
  now: number = Date.now(),
): void => {
  if (isRecentGrant(grantId, now)) count(`fail:${grantId}`, now);
  else count(ipLimitKey(ip), now);
};

export const recordAuthSuccess = (grantId: string, now: number = Date.now()): void => {
  recentGrants.delete(grantId);
  if (recentGrants.size >= RECENT_GRANTS_MAX) {
    const oldest = recentGrants.keys().next().value;
    if (oldest !== undefined) recentGrants.delete(oldest);
  }
  recentGrants.set(grantId, now + RECENT_GRANT_MS);
};

/**
 * Drops expired counters and recent-grant entries. Run by the daily cleanup,
 * so an IP address held for a limit is gone within a day of its window ending
 * even on a server too quiet for the size-triggered prune in `count`. The
 * privacy policy states this bound.
 */
export const pruneCaptureRateLimits = (now: number = Date.now()): void => {
  for (const [key, counter] of counters) if (now >= counter.resetAt) counters.delete(key);
  for (const [grantId, until] of recentGrants)
    if (now >= until) recentGrants.delete(grantId);
};

/** @internal tests only */
export const countCaptureRateLimitEntriesForTests = (): number =>
  counters.size + recentGrants.size;

/** @internal tests only */
export const resetCaptureRateLimitForTests = (): void => {
  counters.clear();
  recentGrants.clear();
  nextPruneAt = 0;
};

/** Browser authorization and short-code guessing limits, separate from MCP egress. */
export const isCaptureOAuthLimited = (
  action: 'authorize' | 'approve',
  ip: string,
  now = Date.now(),
): boolean => {
  const key = `oauth:${action}:${ipLimitKey(ip)}`;
  const hour = 60 * 60 * 1000;
  // A shared approval quota lets unauthenticated guesses block every user's consent.
  if (isOverLimit(key, action === 'authorize' ? 20 : 10, now)) return true;
  count(key, now, action === 'authorize' ? hour : WINDOW_MS);
  return false;
};
