/**
 * Narrow storage port for SuperSync's `lastServerSeq` state.
 *
 * Each method takes a host-computed key (the package owns the prefix
 * + hashing logic; see `SuperSyncProvider._getServerSeqKey`). Sync
 * because `localStorage` (the typical app-side backing) is sync; if a
 * host needs async, change the return types and the provider can
 * `await`.
 *
 * Not generic `KeyValueStoragePort` by design — `lastServerSeq` is
 * provider state, not transport state, and the narrow port keeps the
 * package's prefix + int-conversion concerns out of the adapter.
 */
export interface SuperSyncStorage {
  /** Returns `null` if the key is unset. */
  getLastServerSeq(key: string): number | null;
  setLastServerSeq(key: string, value: number): void;
  removeLastServerSeq(key: string): void;
}
