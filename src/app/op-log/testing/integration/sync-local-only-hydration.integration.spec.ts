/**
 * Integration test for the #8077 own-op-replay regression.
 *
 * Drives the REAL apply chain — `bulkApplyOperations` (carrying localClientId)
 * → `bulkOperationsMetaReducer` (which tags `isApplyingFromOtherClient`) →
 * `globalConfigReducer` — to pin both directions of per-device local-only sync
 * settings:
 *
 *  1. Replaying the device's OWN sync-config op during hydration applies it
 *     faithfully, even when the crash snapshot predates the op (local
 *     `syncProvider` is still null mid-replay). Regressing this (keying
 *     preservation off `isRemote`) silently nulled the provider and disabled
 *     sync — the scheduled-e2e failures (webdav-encryption-disable,
 *     supersync-multi-tab) this fixes.
 *  2. A genuinely FOREIGN client's sync-config op still preserves this device's
 *     local-only settings while applying truly shared ones.
 *
 * Unlike the reducer unit test (which hand-builds the tagged action), this
 * exercises the actual wiring the fix added: the op→action conversion, the
 * clientId-based tagging in the meta-reducer, and the reducer gate.
 */
import { Action, ActionReducer } from '@ngrx/store';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import { ActionType, EntityType, Operation, OpType } from '../../core/operation.types';
import {
  globalConfigReducer,
  initialGlobalConfigState,
} from '../../../features/config/store/global-config.reducer';
import {
  GlobalConfigState,
  SyncConfig,
} from '../../../features/config/global-config.model';
import { SyncProviderId } from '../../sync-providers/provider.const';

describe('Sync local-only settings — hydration replay integration (#8077)', () => {
  const composedReducer = bulkOperationsMetaReducer(globalConfigReducer) as ActionReducer<
    GlobalConfigState,
    Action
  >;

  // Build a real GLOBAL_CONFIG_UPDATE_SECTION(sync) op, matching the on-the-wire
  // shape captured by operation-log.effects (actionPayload + empty entityChanges).
  const createSyncSectionOp = (
    clientId: string,
    sectionCfg: Partial<SyncConfig>,
  ): Operation => ({
    id: `op-${clientId}`,
    actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
    opType: OpType.Update,
    entityType: 'GLOBAL_CONFIG' as EntityType,
    // Real updateGlobalConfigSection uses the section key as the entity id
    // (see global-config.actions.ts), so match that here.
    entityId: 'sync',
    payload: {
      actionPayload: { sectionKey: 'sync', sectionCfg },
      entityChanges: [],
    },
    clientId,
    vectorClock: { [clientId]: 1 },
    timestamp: 1_700_000_000_000,
    schemaVersion: 1,
  });

  it('applies the device own sync-setup op faithfully during hydration replay', () => {
    // Mid-hydration: the crash snapshot predates the sync-setup op, so the
    // provider is not set yet in the state we replay onto.
    const preSetupState: GlobalConfigState = {
      ...initialGlobalConfigState,
      sync: {
        ...initialGlobalConfigState.sync,
        syncProvider: null,
        isEnabled: false,
        isEncryptionEnabled: false,
      },
    };

    const ownClientId = 'device-A';
    const ownSetupOp = createSyncSectionOp(ownClientId, {
      isEnabled: true,
      syncProvider: SyncProviderId.WebDAV,
      isEncryptionEnabled: true,
      syncInterval: 300000,
      isManualSyncOnly: true,
    });

    const result = composedReducer(
      preSetupState,
      bulkApplyOperations({ operations: [ownSetupOp], localClientId: ownClientId }),
    );

    // The op's own values win — sync is configured, not silently disabled.
    expect(result.sync.syncProvider).toBe(SyncProviderId.WebDAV);
    expect(result.sync.isEnabled).toBe(true);
    expect(result.sync.isEncryptionEnabled).toBe(true);
    expect(result.sync.syncInterval).toBe(300000);
    expect(result.sync.isManualSyncOnly).toBe(true);
  });

  it("preserves this device's local-only settings against a foreign client op", () => {
    const localState: GlobalConfigState = {
      ...initialGlobalConfigState,
      sync: {
        ...initialGlobalConfigState.sync,
        syncProvider: SyncProviderId.WebDAV,
        isEnabled: true,
        isEncryptionEnabled: true,
        syncInterval: 300000,
        isManualSyncOnly: true,
        isCompressionEnabled: false,
      },
    };

    const foreignOp = createSyncSectionOp('device-B', {
      // local-only keys — must NOT be adopted from another device
      syncProvider: SyncProviderId.Dropbox,
      isEnabled: false,
      isEncryptionEnabled: false,
      syncInterval: 60000,
      isManualSyncOnly: false,
      // genuinely shared key — must sync
      isCompressionEnabled: true,
    });

    const result = composedReducer(
      localState,
      bulkApplyOperations({ operations: [foreignOp], localClientId: 'device-A' }),
    );

    // Local-only device/schedule settings are preserved...
    expect(result.sync.syncProvider).toBe(SyncProviderId.WebDAV);
    expect(result.sync.isEnabled).toBe(true);
    expect(result.sync.isEncryptionEnabled).toBe(true);
    expect(result.sync.syncInterval).toBe(300000);
    expect(result.sync.isManualSyncOnly).toBe(true);
    // ...while genuinely shared settings still sync.
    expect(result.sync.isCompressionEnabled).toBe(true);
  });
});
