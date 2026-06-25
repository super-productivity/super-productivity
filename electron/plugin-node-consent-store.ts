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
  consents: { [pluginId: string]: PersistedNodeExecutionConsent };
}

const emptyBlob = (): NodeExecutionConsentBlob => ({
  version: NODE_EXECUTION_CONSENT_STORE_VERSION,
  consents: {},
});

const loadBlob = async (): Promise<NodeExecutionConsentBlob> => {
  const all = await loadSimpleStoreAll();
  const raw = all[SimpleStoreKey.PLUGIN_NODE_EXECUTION_CONSENT];
  if (!raw || typeof raw !== 'object') {
    return emptyBlob();
  }
  const blob = raw as Partial<NodeExecutionConsentBlob>;
  // Forward-safe: a future on-disk format we don't understand is ignored (the user is
  // re-prompted) rather than mis-read into a spurious grant. Never downgrade-corrupt it.
  if (
    blob.version !== NODE_EXECUTION_CONSENT_STORE_VERSION ||
    !blob.consents ||
    typeof blob.consents !== 'object'
  ) {
    return emptyBlob();
  }
  return {
    version: NODE_EXECUTION_CONSENT_STORE_VERSION,
    consents: { ...blob.consents },
  };
};

// Serialize read-modify-write mutations so two concurrent grants/clears can't clobber
// each other (load-load-write-write). Reads (getNodeExecutionConsent) need no lock.
let _mutationQueue: Promise<unknown> = Promise.resolve();

const mutate = (apply: (blob: NodeExecutionConsentBlob) => boolean): Promise<void> => {
  const run = async (): Promise<void> => {
    const blob = await loadBlob();
    if (apply(blob)) {
      await saveSimpleStore(SimpleStoreKey.PLUGIN_NODE_EXECUTION_CONSENT, blob);
    }
  };
  _mutationQueue = _mutationQueue.then(run, run);
  return _mutationQueue as Promise<void>;
};

export const getNodeExecutionConsent = async (
  pluginId: string,
): Promise<PersistedNodeExecutionConsent | null> => {
  const blob = await loadBlob();
  return blob.consents[pluginId] ?? null;
};

export const setNodeExecutionConsent = async (
  pluginId: string,
  consent: PersistedNodeExecutionConsent,
): Promise<void> =>
  mutate((blob) => {
    blob.consents[pluginId] = {
      name: consent.name,
      version: consent.version,
      grantedAt: consent.grantedAt,
    };
    return true;
  });

export const clearNodeExecutionConsent = async (pluginId: string): Promise<void> =>
  mutate((blob) => {
    if (!blob.consents[pluginId]) {
      return false;
    }
    delete blob.consents[pluginId];
    return true;
  });
