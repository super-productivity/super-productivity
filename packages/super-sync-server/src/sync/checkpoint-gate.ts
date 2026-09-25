/**
 * Client-checkpoint gate (#9962).
 *
 * Under mandatory E2EE only a client can create the causal full-state
 * boundary that authorizes the old-ops sweep to prune a user's history, and
 * routine incremental sync never creates one. An automatic checkpoint cadence
 * would fix that, but releases before v18.21.2 treat a REPAIR op as a full
 * reset and drop offline edits concurrent with it (the narrower REPAIR
 * semantics landed in 78a459294104, first shipped in v18.21.2). So a cadence
 * may only ever be enabled for an account whose every active device runs a
 * release at or above that cut.
 *
 * Clients report their bare semver as the `appVersion` query parameter on the
 * download path (sync.routes.ts → DeviceService.touchDevice). A device with
 * no reported version counts as old: every release that reports one is newer
 * than the cut, so silence can only mean a pre-reporting client.
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
 * Whether one reported version keeps concurrent edits across a REPAIR.
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
 * Whether every device of an account is checkpoint-safe. An account with no
 * device inside the window is NOT safe: there is nobody to create a
 * checkpoint for, and "no devices" must never read as "all devices agree".
 */
export const isAccountCheckpointSafe = (
  devices: readonly CheckpointGateDevice[],
): boolean =>
  devices.length > 0 && devices.every((d) => isCheckpointSafeAppVersion(d.appVersion));

export interface CheckpointGateFleetSummary {
  /** Accounts with at least one device in the window whose devices are all safe. */
  safeAccounts: number;
  /** Accounts with at least one device in the window. */
  totalAccounts: number;
  /** Devices in the window that never reported a version. */
  unversionedDevices: number;
}

/**
 * Fleet-wide roll-up of the gate over one row per device in the window. This
 * is the number that decides when a cadence can be switched on, so it is
 * logged by the daily cleanup unconditionally.
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
