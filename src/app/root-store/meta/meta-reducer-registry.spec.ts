import { META_REDUCERS } from './meta-reducer-registry';
import { loadAllDataFailureGuardMetaReducer } from '../../op-log/apply/load-all-data-failure-guard.meta-reducer';
import { operationCaptureMetaReducer } from '../../op-log/capture/operation-capture.meta-reducer';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';

describe('META_REDUCERS registry', () => {
  // The dev-mode validateMetaReducerOrdering() covers index 0/1/last; this
  // spec guards registrations it does not.
  it('registers the loadAllData failure guard (#9140 hydration fallback depends on it)', () => {
    expect(META_REDUCERS.indexOf(loadAllDataFailureGuardMetaReducer)).toBeGreaterThan(
      META_REDUCERS.indexOf(bulkOperationsMetaReducer),
    );
  });

  it('keeps the hard ordering constraints intact', () => {
    expect(META_REDUCERS[0]).toBe(operationCaptureMetaReducer);
    expect(META_REDUCERS[1]).toBe(bulkOperationsMetaReducer);
  });
});
