import { IS_ELECTRON } from '../../app.constants';
import { IS_IOS } from '../../util/is-ios';
import { IS_IOS_NATIVE } from '../../util/is-native-platform';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { MIN_CLIENT_ID_LENGTH } from '../../op-log/core/operation-log.const';

/**
 * Client-ID generation and format validation.
 *
 * Extracted from ClientIdService so destructive-flow callers (clean-slate,
 * backup-restore) can mint an id without going through the stateful service —
 * the new id is persisted only inside the atomic SUP_OPS transaction in
 * OperationLogStoreService.runDestructiveStateReplacement. See issue #7732.
 *
 * No DI. Platform detection reuses the app-wide constants rather than
 * re-deriving it here: local re-derivation is what broke in #9353. Those
 * constants are frozen at module load and cannot be stubbed, so the mapping is
 * split into a pure `getPlatformCode()` that a spec can drive directly — the
 * same split `util/get-app-version-str.ts` uses for `distChannelSuffix()`.
 */

/**
 * Every clientId prefix this app has ever minted. Single source for the union
 * type and the decoder below, so a new code cannot drift between them: adding
 * one here widens `PlatformCode`, which is a compile error at every exhaustive
 * consumer (e.g. the `Record<PlatformCode, …>` icon map), and the decoder
 * accepts it automatically.
 */
const PLATFORM_CODES = ['B', 'E', 'A', 'I'] as const;

export type PlatformCode = (typeof PLATFORM_CODES)[number];

interface ClientPlatform {
  isElectron: boolean;
  isAndroid: boolean;
  isIos: boolean;
}

/**
 * Maps a platform to the single character that prefixes a compact client ID.
 * B = Browser, E = Electron, A = Android, I = iOS.
 *
 * The three predicates are independent, so nothing structurally prevents an
 * overlap and the order is a deliberate guard rather than an arbitrary one. The
 * closest real case is macOS Electron, which already satisfies `IS_IOS`'s
 * `Mac` user-agent half — only `'ontouchend' in document` (false on Macs today)
 * keeps it from also reading as iOS. Electron therefore wins first.
 */
export const getPlatformCode = (platform: ClientPlatform): PlatformCode => {
  if (platform.isElectron) {
    return 'E';
  }
  if (platform.isAndroid) {
    return 'A';
  }
  if (platform.isIos) {
    return 'I';
  }
  return 'B';
};

/**
 * Reads back the platform a clientId was minted on, or null when the prefix is
 * not one this app can decode without guessing.
 *
 * The inverse of `getPlatformCode`, kept in the same file for the reason its
 * header gives: when the two halves of an id's contract live apart, one drifts.
 *
 * Legacy PFAPI ids were `{getEnvironmentId()}_{Date.now()}` with multi-char
 * environment prefixes: Electron `E_{os}_…` happens to match the current
 * one-letter-underscore shape, and Android's fixed `AND_…` is special-cased
 * below. Legacy browser ids (`B{browser}{os}_…`, e.g. `BCL_…`) deliberately
 * return null — decoding them would need the full historical browser/OS code
 * table, and "unknown" is safer than a wrong guess.
 */
export const getClientIdPlatformCode = (clientId: string): PlatformCode | null => {
  if (clientId.startsWith('AND_')) {
    return 'A';
  }
  const code = clientId.slice(0, 1);
  return clientId[1] === '_' && (PLATFORM_CODES as readonly string[]).includes(code)
    ? (code as PlatformCode)
    : null;
};

export const getCurrentPlatformCode = (): PlatformCode =>
  getPlatformCode({
    isElectron: IS_ELECTRON,
    // `window.SUPAndroid`, injected by both Android activities
    // (CapacitorMainActivity and the legacy FullscreenActivity), so Play and
    // F-Droid both stay 'A'. Deliberately narrower than the `Android`+`wv`
    // user-agent test it replaces: our page inside some *other* app's WebView
    // is a browser for forensic purposes, and now reports 'B'.
    isAndroid: IS_ANDROID_WEB_VIEW,
    // Capacitor first — it is authoritative for the native app, which is the
    // case that actually broke, and cannot drift when Apple changes a UA. IS_IOS
    // is the web fallback: it carries the iPadOS desktop-UA workaround and keeps
    // mobile Safari on 'I'. IS_IOS_NATIVE alone would demote iPhone Safari to
    // 'B'; IS_IOS alone would leave native detection resting on a deprecated
    // `navigator.platform` heuristic — the same fragility as the original bug.
    isIos: IS_IOS_NATIVE || IS_IOS,
  });

/**
 * Generates a random base62 string of the specified length.
 * Uses crypto.getRandomValues() for non-predictable randomness.
 */
const _generateBase62 = (length: number): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};

/**
 * Generates a compact client ID: {platform}_{6-char-base62}, e.g. "B_a7Kx9Z".
 */
export const generateClientId = (): string => {
  return `${getCurrentPlatformCode()}_${_generateBase62(6)}`;
};

/**
 * Charset every clientId must satisfy to survive a round trip to SuperSync
 * (`SUPER_SYNC_CLIENT_ID_REGEX` in `@sp/shared-schema`). Inlined rather than
 * imported because that module pulls in zod and this file sits on the boot
 * path with no dependencies by design. `generate-client-id.spec.ts` pins the
 * coupling in the direction that matters: every id SuperSync would carry must
 * pass this predicate.
 */
const USABLE_CLIENT_ID_CHARSET = /^[a-zA-Z0-9_-]+$/;

/**
 * Type guard: true if `id` is a clientId this app can actually USE.
 *
 * ⚠️ This asks "can the system use this id?", never "did THIS build mint it?".
 * The distinction is the whole bug in #9336 and #6197/#6142: an id is a
 * persisted, non-regenerable vector-clock key, so this predicate is applied to
 * whatever any past build wrote to disk — not to freshly generated values.
 *
 * "Invalid" means "absent" all the way down: a rejected id reads as null
 * (`client-id.service.ts:165`) and is then minted over (`:217`) — a silent,
 * permanent identity rotation, the loss #7732 exists to prevent. So:
 *
 * **NEVER narrow this predicate.** Widening the generator (4→6 random chars in
 * ec16757c82, shipped v18.11.0) while narrowing the matching check orphaned
 * every id minted by v17.0.0–v18.10.0. The same mistake in the other direction
 * (emitting a new shape before readers accept it) caused #6142/#6197/#6274/
 * #6588/#6793. Both halves of that contract now live here, so the accepted set
 * is deliberately looser than anything we mint: the `>= 10` branch keeps every
 * legacy PFAPI id (`getEnvironmentId() + '_' + Date.now()`), and the charset
 * branch accepts any future prefix or entropy bump without another edit.
 *
 * The floor is `MIN_CLIENT_ID_LENGTH` because `incrementVectorClock` throws
 * below it — that, and the SuperSync charset, are the only real constraints.
 */
export const isValidClientIdFormat = (id: unknown): id is string => {
  return (
    typeof id === 'string' &&
    (id.length >= 10 ||
      (id.length >= MIN_CLIENT_ID_LENGTH && USABLE_CLIENT_ID_CHARSET.test(id)))
  );
};
