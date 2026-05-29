import { PluginUserData, PluginUserDataState } from '../plugin-persistence.model';
import { extractOwnerPluginId } from './plugin-persistence-key.util';

/**
 * Returns the deduped set of *owner* pluginIds whose persisted data changed
 * between two snapshots — added, deleted, or `data` differs.
 *
 * `PluginUserData.id` is the storage entityId, which is `pluginId` for the
 * legacy single-blob form and `pluginId:key` for Stage A keyed entries. Hook
 * handlers are registered under the bare pluginId, so this function maps
 * back to the owner before deduping. A plugin with five keyed entries that
 * all change in one emission fires the hook exactly once.
 *
 * Correctness contract: equality is `===` on the encoded `data` blob.
 * **Never decode the gzip+base64 payload to "compare smartly."** Decoding
 * allocates and the encoded form is what sync compares — the differ has to
 * agree. Re-encoding identical plaintext yields byte-identical base64 per
 * WHATWG `CompressionStream('gzip')` semantics, so identity check on the
 * blob is sufficient to skip no-op writes.
 */
export const diffChangedPluginIds = (
  prev: PluginUserDataState,
  next: PluginUserDataState,
): string[] => {
  const prevMap = new Map<string, PluginUserData>(prev.map((e) => [e.id, e]));
  const owners = new Set<string>();

  for (const entry of next) {
    const prior = prevMap.get(entry.id);
    if (!prior || prior.data !== entry.data) {
      owners.add(extractOwnerPluginId(entry.id));
    }
    prevMap.delete(entry.id);
  }
  for (const id of prevMap.keys()) {
    owners.add(extractOwnerPluginId(id));
  }

  return Array.from(owners);
};
