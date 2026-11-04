import { InjectionToken } from '@angular/core';
import { Operation } from '../core/operation.types';

/**
 * Lets a feature observe remote ops around their reducer pass without the
 * op-log layer depending on that feature (provided in main.ts).
 *
 * Not called for local hydration or `skipReducerDispatch` retries: those do not
 * run the reducers here, so there is no "before" state to read.
 */
export interface RemoteApplyListener {
  /**
   * Called synchronously right before the batch reaches the reducers, so it
   * can still read the pre-apply state. Must not throw or block. Returns a
   * callback that gets the ops whose reducers committed.
   */
  beforeRemoteApply(
    ops: readonly Operation[],
  ): (reducerCommittedOps: readonly Operation[]) => void;
}

export const REMOTE_APPLY_LISTENER = new InjectionToken<RemoteApplyListener>(
  'REMOTE_APPLY_LISTENER',
);
