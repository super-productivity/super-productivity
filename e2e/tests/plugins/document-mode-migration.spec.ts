import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

/**
 * End-to-end coverage of the Stage A keyed persistence migration in the
 * bundled document-mode plugin. The migration logic is unit-tested against
 * a mock PluginAPI (`packages/plugin-dev/document-mode/src/persistence.spec.ts`),
 * but those tests can't catch real-iframe quirks: postMessage handling of
 * `undefined` second args, commit-chain timing across the host's rate
 * limiter, hydration ordering against the op-log.
 *
 * Two scenarios:
 *  - fresh install: enable the plugin, verify the `__meta__` stamp lands
 *    with `migrated: 1`.
 *  - legacy blob: seed a pre-Stage-A single-blob entry into NgRx via the
 *    e2e helper store, enable the plugin, verify it splits into `meta` +
 *    `doc:${ctxId}` keyed entries and tombstones the legacy id.
 */

const PLUGIN_ID = 'document-mode';
// Underscore-cased so the @typescript-eslint/naming-convention rule on
// object literal keys is happy. The keys are opaque context ids; their
// shape doesn't matter to the host.
const CTX_ALPHA = 'p_alpha';
const CTX_BETA = 'p_beta';
const LEGACY_DOCS: Record<string, unknown> = {
  [CTX_ALPHA]: { type: 'doc', content: [{ type: 'paragraph' }] },
  [CTX_BETA]: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'seed' }] }],
  },
};
const LEGACY_BLOB = JSON.stringify({
  version: 1,
  docs: LEGACY_DOCS,
  enabledCtxIds: [CTX_ALPHA],
});

type PluginUserDataEntry = { id: string; data: string };

/**
 * Read the current `pluginUserData` feature state from the live store
 * exposed at `window.__e2eTestHelpers.store` (only present in dev/stage
 * builds, see main.ts).
 */
const readPluginState = async (
  page: import('@playwright/test').Page,
): Promise<PluginUserDataEntry[] | null> =>
  page.evaluate<PluginUserDataEntry[] | null>(async () => {
    const helpers = (window as unknown as { __e2eTestHelpers?: { store?: unknown } })
      .__e2eTestHelpers;
    const store = helpers?.store as
      | {
          select: (fn: (s: Record<string, unknown>) => unknown) => {
            subscribe: (cb: (v: unknown) => void) => { unsubscribe: () => void };
          };
        }
      | undefined;
    if (!store) return null;
    return new Promise<PluginUserDataEntry[] | null>((resolve) => {
      const subRef: { current?: { unsubscribe: () => void } } = {};
      subRef.current = store
        .select((s) => s.pluginUserData)
        .subscribe((value) => {
          // Defer unsubscribe so the initial sync emit isn't cancelled before
          // we receive it.
          window.setTimeout(() => subRef.current?.unsubscribe());
          resolve(Array.isArray(value) ? (value as PluginUserDataEntry[]) : null);
        });
    });
  });

const findEntry = (
  entries: PluginUserDataEntry[] | null,
  id: string,
): PluginUserDataEntry | undefined => entries?.find((e) => e.id === id);

test.describe('Document Mode Stage A migration', () => {
  test('stamps migration success on a fresh install', async ({ page, workViewPage }) => {
    test.setTimeout(60000);

    const assetsAvailable = await waitForPluginAssets(page);
    if (!assetsAvailable) {
      if (process.env.CI) {
        test.skip(true, 'Plugin assets not available in CI');
        return;
      }
      throw new Error('Plugin assets not available — run `npm run prebuild`');
    }

    await workViewPage.waitForTaskList();
    const pluginReady = await waitForPluginManagementInit(page);
    expect(pluginReady).toBeTruthy();

    const enabled = await enablePluginWithVerification(page, 'Document Mode');
    expect(enabled).toBeTruthy();

    // The migration runs once the plugin's background.js executes init().
    // Poll until the keyed stamp lands.
    await expect
      .poll(
        async () => {
          const entries = await readPluginState(page);
          const stamp = findEntry(entries, `${PLUGIN_ID}:__meta__`);
          if (!stamp?.data) return null;
          try {
            return JSON.parse(stamp.data) as { migrated?: number };
          } catch {
            return null;
          }
        },
        { timeout: 15000, message: 'migration stamp never reached migrated:1' },
      )
      .toMatchObject({ migrated: 1 });
  });

  test('migrates a legacy single-blob entry into keyed entries', async ({
    page,
    workViewPage,
  }) => {
    test.setTimeout(60000);

    const assetsAvailable = await waitForPluginAssets(page);
    if (!assetsAvailable) {
      if (process.env.CI) {
        test.skip(true, 'Plugin assets not available in CI');
        return;
      }
      throw new Error('Plugin assets not available — run `npm run prebuild`');
    }

    await workViewPage.waitForTaskList();

    // Seed pre-Stage-A storage: a single keyless entry under the bare
    // plugin id. Dispatched via the same action the host would emit, so
    // the op-log + state both see a "legacy upsert" from this client.
    await page.evaluate(
      async ({ pluginId, blob }) => {
        const helpers = (window as unknown as { __e2eTestHelpers?: { store?: unknown } })
          .__e2eTestHelpers;
        const store = helpers?.store as
          | { dispatch: (action: unknown) => void }
          | undefined;
        if (!store) {
          throw new Error('__e2eTestHelpers.store not exposed — non-dev build?');
        }
        store.dispatch({
          type: '[Plugin] Upsert User Data',
          pluginUserData: { id: pluginId, data: blob },
          meta: {
            isPersistent: true,
            entityType: 'PLUGIN_USER_DATA',
            entityId: pluginId,
            opType: 'UPDATE',
          },
        });
      },
      { pluginId: PLUGIN_ID, blob: LEGACY_BLOB },
    );

    // Sanity-check the seed landed before enabling the plugin.
    const seeded = findEntry(await readPluginState(page), PLUGIN_ID);
    expect(seeded?.data).toBe(LEGACY_BLOB);

    const pluginReady = await waitForPluginManagementInit(page);
    expect(pluginReady).toBeTruthy();

    const enabled = await enablePluginWithVerification(page, 'Document Mode');
    expect(enabled).toBeTruthy();

    // Wait for the migration to stamp success. The full sequence is:
    // attempted stamp → write each doc → write meta → tombstone legacy →
    // success stamp. The final stamp is the last write, so observing it
    // means everything else has landed.
    await expect
      .poll(
        async () => {
          const entries = await readPluginState(page);
          const stamp = findEntry(entries, `${PLUGIN_ID}:__meta__`);
          if (!stamp?.data) return null;
          try {
            return JSON.parse(stamp.data) as { migrated?: number };
          } catch {
            return null;
          }
        },
        { timeout: 15000, message: 'migration never stamped migrated:1' },
      )
      .toMatchObject({ migrated: 1 });

    // Now inspect the rest of the keyspace.
    const entries = await readPluginState(page);

    // The legacy entry is tombstoned (empty payload) — present but empty.
    const legacy = findEntry(entries, PLUGIN_ID);
    expect(legacy?.data).toBe('');

    // The meta entry holds the migrated enabledCtxIds.
    const meta = findEntry(entries, `${PLUGIN_ID}:meta`);
    expect(meta).toBeDefined();
    const metaParsed = JSON.parse(meta!.data) as { enabledCtxIds: string[] };
    expect(metaParsed.enabledCtxIds).toEqual([CTX_ALPHA]);

    // Each legacy doc became its own keyed entry. Compare the parsed
    // shape rather than the exact serialized string — the host may have
    // re-encoded (e.g. via the gzip codec for large payloads).
    for (const [ctxId, expectedDoc] of Object.entries(LEGACY_DOCS)) {
      const entry = findEntry(entries, `${PLUGIN_ID}:doc:${ctxId}`);
      expect(entry, `expected entry for doc:${ctxId}`).toBeDefined();
      expect(JSON.parse(entry!.data)).toEqual(expectedDoc);
    }
  });
});
