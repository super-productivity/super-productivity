import { META_REDUCERS } from './meta-reducer-registry';
import { loadAllDataFailureGuardMetaReducer } from '../../op-log/apply/load-all-data-failure-guard.meta-reducer';
import { operationCaptureMetaReducer } from '../../op-log/capture/operation-capture.meta-reducer';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { undoTaskDeleteMetaReducer } from './undo-task-delete.meta-reducer';

describe('META_REDUCERS registry', () => {
  // The dev-mode validateMetaReducerOrdering() covers index 0/1/last; this
  // spec guards registrations it does not.
  it('registers the loadAllData failure guard (#9140 hydration fallback depends on it)', () => {
    const guardIdx = META_REDUCERS.indexOf(loadAllDataFailureGuardMetaReducer);
    expect(guardIdx).toBeGreaterThan(META_REDUCERS.indexOf(bulkOperationsMetaReducer));
    // The guard must wrap every reducer that handles loadAllData — i.e. sit
    // before the Phase 3+ meta-reducers, not just anywhere in the chain.
    expect(guardIdx).toBeLessThan(META_REDUCERS.indexOf(undoTaskDeleteMetaReducer));
  });

  it('keeps the hard ordering constraints intact', () => {
    expect(META_REDUCERS[0]).toBe(operationCaptureMetaReducer);
    expect(META_REDUCERS[1]).toBe(bulkOperationsMetaReducer);
  });
});
