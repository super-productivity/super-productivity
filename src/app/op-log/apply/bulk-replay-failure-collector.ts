import type { Operation } from '../core/operation.types';

export interface BulkReplayReducerFailure {
  op: Operation;
  error: Error;
}

type FailureCollector = (failure: BulkReplayReducerFailure) => void;

let activeFailureCollector: FailureCollector | undefined;

/**
 * Scopes reducer-failure reporting to one synchronous NgRx bulk dispatch.
 *
 * Keeping the collector outside the action preserves NgRx action
 * serializability and immutability. NgRx reducers run synchronously, so the
 * collector is always restored before dispatch returns.
 */
export const runWithBulkReplayFailureCollector = <T>(
  collector: FailureCollector,
  run: () => T,
): T => {
  const previousCollector = activeFailureCollector;
  activeFailureCollector = collector;
  try {
    return run();
  } finally {
    activeFailureCollector = previousCollector;
  }
};

export const reportBulkReplayReducerFailure = (op: Operation, error: unknown): void => {
  activeFailureCollector?.({
    op,
    error: error instanceof Error ? error : new Error(String(error)),
  });
};
