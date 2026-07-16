/**
 * Fields describing HOW content is encrypted, not WHICH remote is addressed.
 *
 * Every other field counts as identity-affecting, so an unrecognised or newly
 * added one errs toward invalidating rather than silently reusing one target's
 * cursor against another. Only add a field here once it provably cannot change
 * which remote is addressed.
 */
const CONTENT_ONLY_CFG_FIELDS: ReadonlySet<string> = new Set([
  'encryptKey',
  'isEncryptionEnabled',
]);

/**
 * `PROVIDER_FIELD_DEFAULTS` (sync-config.service) is re-merged on every save, so
 * a config predating a default gets that key seeded on its next save — which
 * without this would read as a target move. Attested: `loginName: ''` was added
 * to Nextcloud's defaults after configs existed. Cannot mask a real move —
 * clearing a folder still compares `'/foo'` → absent.
 *
 * Deliberately incomplete: OneDrive's defaults are the only non-`''` ones
 * (`tenantId: 'common'`, `syncFolderPath: 'Super Productivity'`, …), so such a
 * config still reports a spurious move on its first save — one-time and
 * self-correcting. Covering it would drag the imex/sync defaults table into
 * op-log for less than it costs.
 */
const isUnset = (value: unknown): boolean => value === undefined || value === '';

/**
 * Sorted because key order need not survive a persist/load round-trip; flat
 * because every provider privateCfg is `string | boolean | number` throughout.
 */
const toTargetIdentity = (cfg: Record<string, unknown>): string =>
  Object.entries(cfg)
    .filter(([k, v]) => !CONTENT_ONLY_CFG_FIELDS.has(k) && !isUnset(v))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('&');

/**
 * Whether two configs address a DIFFERENT remote (account switch behind the same
 * provider id, folder/URL change) rather than a content-only edit. Keeps
 * per-target state alive across routine saves — see
 * `FileBasedSyncAdapterService.invalidateAllTargets` for why firing on a
 * content-only save loses data. No previous config (first-time setup) counts as
 * a change; there is no state to keep.
 *
 * Do NOT add a `prevCfg === nextCfg` fast path. It cannot speed up any real
 * input, and the one case it changes the answer it gets wrong:
 * `SyncCredentialStore.load()` returns the live cached object, so a caller that
 * mutates it in place and passes it back would be told "no change" — a silent
 * false negative. Callers must pass a new object (all do today).
 */
export const isSyncTargetChanged = (prevCfg: unknown, nextCfg: object): boolean =>
  !prevCfg ||
  toTargetIdentity(prevCfg as Record<string, unknown>) !==
    toTargetIdentity(nextCfg as Record<string, unknown>);
