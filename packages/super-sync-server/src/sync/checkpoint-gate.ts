/**
 * Client-checkpoint compatibility diagnostics (#9962).
 *
 * Under mandatory E2EE only a client can create the causal full-state
 * boundary that authorizes the old-ops sweep to prune a user's history, and
 * routine incremental sync never creates one. An automatic checkpoint cadence
 * needs a separate compatibility design. Concurrent-preserving REPAIR filtering
 * landed in 329da9b9f313 (v18.15.0), but later fixes cover the incoming-REPAIR
 * conflict gate (577bdbbf138, v18.21.0) and failed-heal progress (633a27b68e3,
 * v18.21.2). Keep v18.21.2 as a conservative diagnostic cutoff, not proof of
 * end-to-end checkpoint safety.
 *
 * Clients report their bare semver as the `appVersion` query parameter on the
 * download path (sync.routes.ts → DeviceService.touchDevice). A device with
 * no reported version counts as old. These reports cannot authorize cadence:
 * devices can return after retention, and recording versions is asynchronous.
 * Compatibility must also hold for checkpoints stored before an old device
 * returns and for devices arriving during checkpoint acceptance.
 *
 * Pure functions only; the per-account and fleet-wide queries live in
 * DeviceService.
 */

export const MIN_CHECKPOINT_SAFE_APP_VERSION = '18.21.2';

/**
 * Longest version string the server stores. Longer values are dropped, not
 * truncated, so a stored value is always a complete, parseable version.
 */
const MAX_APP_VERSION_LENGTH = 32;
// `MAJOR.MINOR.PATCH` with an optional prerelease tag (`18.23.0-beta.1`).
const APP_VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(-[0-9A-Za-z.-]+)?$/;

/**
 * Accepts a client-supplied version for storage, or `undefined` when it is
 * absent or not a version. Deliberately lenient about presence and strict
 * about shape: a malformed value must never fail the download it rides on,
 * and an unparseable stored value would only ever count as old anyway.
 */
export const parseAppVersion = (raw: unknown): string | undefined =>
  typeof raw === 'string' &&
  raw.length <= MAX_APP_VERSION_LENGTH &&
  APP_VERSION_RE.test(raw)
    ? raw
    : undefined;

interface ParsedVersion {
  tuple: [number, number, number];
  isPrerelease: boolean;
}

const toParsedVersion = (version: string): ParsedVersion | undefined => {
  const match = APP_VERSION_RE.exec(version);
  if (!match) {
    return undefined;
  }
  return {
    tuple: [Number(match[1]), Number(match[2]), Number(match[3])],
    isPrerelease: match[4] !== undefined,
  };
};

const compareTuples = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
};

const MIN_SAFE = toParsedVersion(MIN_CHECKPOINT_SAFE_APP_VERSION)!;

/**
 * Whether one reported version meets the conservative REPAIR diagnostic cutoff.
 * A prerelease of the cut itself (`18.21.2-beta.1`) may predate the fix and
 * counts as old; a prerelease of any later version is fine.
 */
export const isCheckpointSafeAppVersion = (
  appVersion: string | null | undefined,
): boolean => {
  const parsed = appVersion ? toParsedVersion(appVersion) : undefined;
  if (!parsed) {
    return false;
  }
  const cmp = compareTuples(parsed.tuple, MIN_SAFE.tuple);
  return cmp > 0 || (cmp === 0 && !parsed.isPrerelease);
};

export interface CheckpointGateDevice {
  appVersion: string | null;
}

/**
 * Whether all supplied device versions meet the diagnostic cutoff. An empty
 * window does not qualify. Devices outside this window may still return, so
 * even a positive result is not authorization to create a checkpoint.
 */
export const isAccountCheckpointSafe = (
  devices: readonly CheckpointGateDevice[],
): boolean =>
  devices.length > 0 && devices.every((d) => isCheckpointSafeAppVersion(d.appVersion));

export interface CheckpointGateFleetSummary {
  /** Accounts whose observed devices meet the cutoff, not checkpoint authorization. */
  safeAccounts: number;
  /** Accounts with at least one device in the window. */
  totalAccounts: number;
  /** Devices in the window without a currently recorded version. */
  unversionedDevices: number;
}

/**
 * Fleet-wide diagnostic roll-up over one row per device in the window.
 * Logged by daily cleanup; it cannot decide when cadence is safe to enable.
 */
export const summarizeCheckpointGate = (
  devices: readonly (CheckpointGateDevice & { userId: number })[],
): CheckpointGateFleetSummary => {
  const byUser = new Map<number, CheckpointGateDevice[]>();
  let unversionedDevices = 0;
  for (const device of devices) {
    if (device.appVersion === null) {
      unversionedDevices++;
    }
    const list = byUser.get(device.userId);
    if (list) {
      list.push(device);
    } else {
      byUser.set(device.userId, [device]);
    }
  }
  let safeAccounts = 0;
  for (const list of byUser.values()) {
    if (isAccountCheckpointSafe(list)) {
      safeAccounts++;
    }
  }
  return { safeAccounts, totalAccounts: byUser.size, unversionedDevices };
};
