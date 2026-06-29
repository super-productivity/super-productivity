import { loadSimpleStoreAll, saveSimpleStore } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';

/**
 * Persisted, per-plugin nodeExecution consent (issue #8512 Phase 2).
 *
 * SECURITY / TRUST MODEL
 * - This store lives in the main-owned `simpleSettings` file under the OS userData
 *   dir. It is NEVER part of any pfapi-synced model, so a granted consent on one
 *   device does not auto-grant on another (a node call there triggers a fresh native
 *   prompt). There is no renderer IPC that can *write* a consent entry — only the
 *   native Allow dialog in `plugin-node-executor.ts` calls `setNodeExecutionConsent`.
 *   The renderer can only ask to *clear* consent (fail-safe: clearing forces a
 *   re-prompt, never an auto-grant).
 * - Consent is keyed on `pluginId` only. The "re-ask when the plugin's code changes"
 *   property is achieved structurally, not by a stored code hash: the only legitimate
 *   way an uploaded plugin's code changes is a re-upload, and the renderer clears this
 *   consent on disable, uninstall, and re-upload. A renderer-computed hash would be a
 *   forgeable TOCTOU tripwire with no security value (a granted plugin already has full
 *   machine access via `executeScript`), so it is deliberately omitted. The top-level
 *   `version` field below is the migration anchor if a main-owned hash is ever added.
 * - `name`/`version` are the self-declared display strings shown at grant time. They
 *   are stored for diagnostics/UX only and are NEVER used for authorization — the
 *   non-spoofable trust anchor is the `pluginId`.
 */

export const NODE_EXECUTION_CONSENT_STORE_VERSION = 1 as const;

export interface PersistedNodeExecutionConsent {
  /** Self-declared display name at grant time (unverified for uploaded plugins). */
  name: string;
  /** Self-declared version at grant time (unverified for uploaded plugins). */
  version: string;
  /** ms epoch when the user allowed it. */
  grantedAt: number;
}

interface NodeExecutionConsentBlob {
  version: number;
  // SECURITY: keyed on an attacker-controlled pluginId. A `Map` (not a plain object) is
  // used so an id that names an `Object.prototype` member (`constructor`, `toString`,
  // `valueOf`, `hasOwnProperty`, …) is just an ordinary key that returns `undefined` when
  // absent — it can never resolve to an inherited function the executor would mistake for
  // a stored grant. Mirrors the sibling `grants` Map in plugin-node-executor.ts.
  consents: Map<string, PersistedNodeExecutionConsent>;
}

const emptyBlob = (): NodeExecutionConsentBlob => ({
  version: NODE_EXECUTION_CONSENT_STORE_VERSION,
  consents: new Map(),
});

const loadBlob = async (): Promise<NodeExecutionConsentBlob> => {
  const all = await loadSimpleStoreAll();
  const raw = all[SimpleStoreKey.PLUGIN_NODE_EXECUTION_CONSENT];
  if (!raw || typeof raw !== 'object') {
    return emptyBlob();
  }
  const blob = raw as { version?: unknown; consents?: unknown };
  // Forward-safe: a future on-disk format we don't understand is ignored (the user is
  // re-prompted) rather than mis-read into a spurious grant.
  if (
    blob.version !== NODE_EXECUTION_CONSENT_STORE_VERSION ||
    !blob.consents ||
    typeof blob.consents !== 'object'
  ) {
    return emptyBlob();
  }
  // Build the Map from the persisted plain object. Only a fully well-formed entry counts:
  // mere presence authorizes execution, so a corrupt/tampered value (a primitive, an array,
  // an empty `{}`, or a partial record) is dropped — the user re-prompts — rather than
  // mis-read as a grant. A literal `__proto__`/`constructor` key from a hand-edited file is
  // just an ordinary Map key here, never a prototype write.
  const consents = new Map<string, PersistedNodeExecutionConsent>();
  for (const [pluginId, entry] of Object.entries(
    blob.consents as Record<string, unknown>,
  )) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const { name, version, grantedAt } = entry as Record<string, unknown>;
    if (
      typeof name === 'string' &&
      typeof version === 'string' &&
      typeof grantedAt === 'number' &&
      Number.isFinite(grantedAt)
    ) {
      consents.set(pluginId, { name, version, grantedAt });
    }
  }
  return { version: NODE_EXECUTION_CONSENT_STORE_VERSION, consents };
};

// Serialize read-modify-write mutations so two concurrent grants/clears can't clobber
// each other (load-load-write-write). This is NOT redundant with simple-store's own save
// queue: `loadBlob()` happens *outside* `saveSimpleStore`, so without this lock two
// interleaved mutations could both read the same blob before either writes. Reads
// (getNodeExecutionConsent) are point-in-time and need no lock.
let _mutationQueue: Promise<unknown> = Promise.resolve();

const mutate = (apply: (blob: NodeExecutionConsentBlob) => boolean): Promise<void> => {
  const run = async (): Promise<void> => {
    const blob = await loadBlob();
    if (apply(blob)) {
      // Serialize the Map to a plain object for JSON persistence. `Object.fromEntries`
      // uses define-semantics, so even a literal `__proto__` key becomes an own data
      // property — it cannot pollute a prototype. Downgrade note: an older client that
      // finds a newer on-disk `version` reads it as empty (loadBlob) and this write then
      // replaces it with a v1 blob, discarding a future client's consents — worst case a
      // re-prompt, never a spurious grant.
      await saveSimpleStore(SimpleStoreKey.PLUGIN_NODE_EXECUTION_CONSENT, {
        version: blob.version,
        consents: Object.fromEntries(blob.consents),
      });
    }
  };
  _mutationQueue = _mutationQueue.then(run, run);
  return _mutationQueue as Promise<void>;
};

export const getNodeExecutionConsent = async (
  pluginId: string,
): Promise<PersistedNodeExecutionConsent | null> => {
  const blob = await loadBlob();
  return blob.consents.get(pluginId) ?? null;
};

export const setNodeExecutionConsent = async (
  pluginId: string,
  consent: PersistedNodeExecutionConsent,
): Promise<void> =>
  mutate((blob) => {
    blob.consents.set(pluginId, {
      name: consent.name,
      version: consent.version,
      grantedAt: consent.grantedAt,
    });
    return true;
  });

// `Map.delete` returns true only when an entry existed, which is exactly the
// "write only if changed" signal `mutate` wants — a clear of an absent id is a no-op.
export const clearNodeExecutionConsent = async (pluginId: string): Promise<void> =>
  mutate((blob) => blob.consents.delete(pluginId));
