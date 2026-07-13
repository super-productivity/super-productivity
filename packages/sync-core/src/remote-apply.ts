import type { ApplyOperationsResult, OperationApplyFailure } from './apply.types';
import type { Operation } from './operation.types';
import type { ReducerCommitAwareOperationApplyPort } from './ports';

export interface RemoteOperationAppendResult<
  TOperation extends Operation<string> = Operation,
> {
  seqs: number[];
  writtenOps: TOperation[];
  skippedCount: number;
}

/**
 * Store methods needed by the generic remote-apply coordinator.
 *
 * This stays narrower than a full operation-log database service and only
 * represents the crash-safety transitions around applying remote operations.
 */
export interface RemoteOperationApplyStorePort<
  TOperation extends Operation<string> = Operation,
> {
  appendBatchSkipDuplicates(
    ops: TOperation[],
    source: 'remote',
    options: { pendingApply: true },
  ): Promise<RemoteOperationAppendResult<TOperation>>;
  mergeRemoteOpClocks(ops: TOperation[]): Promise<void>;
  markReducersCommittedAndMergeClocks(
    seqs: number[],
    ops: TOperation[],
    rejectedOpIds?: string[],
  ): Promise<void>;
  markApplied(seqs: number[]): Promise<void>;
  markFailed(opIds: string[]): Promise<void>;
  clearFullStateOpsExcept(excludeIds: string[]): Promise<number>;
}

export interface ApplyRemoteOperationsOptions<
  TOperation extends Operation<string> = Operation,
> {
  ops: TOperation[];
  store: RemoteOperationApplyStorePort<TOperation>;
  applier: ReducerCommitAwareOperationApplyPort<TOperation>;
  isFullStateOperation?: (op: TOperation) => boolean;
  /** Runs after incoming clocks are durable, before reducer application starts. */
  onRemoteClocksDurable?: (ops: TOperation[]) => void;
}

export interface RemoteApplyOperationsResult<
  TOperation extends Operation<string> = Operation,
> {
  appendedOps: TOperation[];
  skippedCount: number;
  appliedOps: TOperation[];
  appliedSeqs: number[];
  clearedFullStateOpCount: number;
  failedOp?: ApplyOperationsResult<TOperation>['failedOp'];
  failedOpIds: string[];
  reducerFailures?: OperationApplyFailure<TOperation>[];
  reducerFailedOpIds?: string[];
}

const emptyRemoteApplyResult = <
  TOperation extends Operation<string>,
>(): RemoteApplyOperationsResult<TOperation> => ({
  appendedOps: [],
  skippedCount: 0,
  appliedOps: [],
  appliedSeqs: [],
  clearedFullStateOpCount: 0,
  failedOpIds: [],
});

/**
 * Applies remote operations through host ports and records crash-safety state.
 *
 * Host apps keep framework-specific dispatch, storage, diagnostics, validation,
 * and user notifications outside the package. This coordinator only enforces
 * the generic ordering:
 *
 * 1. append incoming remote ops as pending, skipping duplicates atomically;
 * 2. durably merge all newly appended remote clocks before reducers or a
 *    deferred-local-action window can start;
 * 3. bulk-apply only the newly appended ops through the host applier;
 * 4. at reducer commit, atomically checkpoint reducer-successful ops as
 *    `archive_pending`, reject reducer-failed ops, and merge successful clocks
 *    before archive side effects begin;
 * 5. mark archive-complete seqs applied;
 * 6. after applying a full-state op, clear older full-state ops while
 *    retaining every full-state op of this batch (incl. quarantined ones);
 * 7. mark only the attempted archive failure as `failed`; unattempted
 *    successors stay `archive_pending` for ordered startup recovery.
 */
export const applyRemoteOperations = async <
  TOperation extends Operation<string> = Operation,
>({
  ops,
  store,
  applier,
  isFullStateOperation = () => false,
  onRemoteClocksDurable,
}: ApplyRemoteOperationsOptions<TOperation>): Promise<
  RemoteApplyOperationsResult<TOperation>
> => {
  if (ops.length === 0) {
    return emptyRemoteApplyResult();
  }

  const appendResult = await store.appendBatchSkipDuplicates(ops, 'remote', {
    pendingApply: true,
  });

  if (appendResult.writtenOps.length === 0) {
    return {
      ...emptyRemoteApplyResult<TOperation>(),
      skippedCount: appendResult.skippedCount,
    };
  }

  // Pending rows make this pre-apply clock merge crash-safe: if anything fails
  // after it commits, startup recovery still replays the same rows. Advancing
  // the clock before entering the reducer window also means buffered local
  // actions can always be drained against a durable remote frontier.
  await store.mergeRemoteOpClocks(appendResult.writtenOps);
  onRemoteClocksDurable?.(appendResult.writtenOps);

  const opIdToSeq = new Map<string, number>();
  appendResult.writtenOps.forEach((op, index) => {
    const seq = appendResult.seqs[index];
    if (seq !== undefined) {
      opIdToSeq.set(op.id, seq);
    }
  });

  let reducerCommitCallbackCount = 0;
  let reducerCommitCallbackError: Error | undefined;
  let reducerCommitPromise: Promise<void> | undefined;
  let reducerCommittedOps: TOperation[] | undefined;
  let reducerFailures: OperationApplyFailure<TOperation>[] | undefined;
  let applyResult: ApplyOperationsResult<TOperation>;
  const observeReducerCommitPromisePreservingPrimaryError = async (): Promise<void> => {
    const promise = reducerCommitPromise;
    if (!promise) {
      return;
    }
    try {
      await promise;
    } catch {
      // The already-selected apply/contract error is the primary failure. The
      // checkpoint rejection is still observed here so it cannot become an
      // unhandled rejection; pending rows make it recoverable at startup.
    }
  };
  try {
    applyResult = await applier.applyOperations(appendResult.writtenOps, {
      onReducersCommitted: (reportedCommittedOps, reportedFailures = []) => {
        reducerCommitCallbackCount++;
        if (reducerCommitCallbackCount !== 1) {
          reducerCommitCallbackError = new Error(
            'applyRemoteOperations: reducer-commit callback must be invoked exactly once.',
          );
          throw reducerCommitCallbackError;
        }

        const authoritativeReducerFailures = getAuthoritativeReducerFailures(
          appendResult.writtenOps,
          reportedFailures,
        );
        const failedFullStateOp = authoritativeReducerFailures.find((failure) =>
          isFullStateOperation(failure.op),
        );
        if (failedFullStateOp) {
          reducerCommitCallbackError = new Error(
            `applyRemoteOperations: full-state operation ${failedFullStateOp.op.id} failed during reducer replay.`,
          );
          throw reducerCommitCallbackError;
        }
        reducerFailures = authoritativeReducerFailures;
        const reducerFailedIds = new Set(
          authoritativeReducerFailures.map((failure) => failure.op.id),
        );
        const expectedCommittedOps = appendResult.writtenOps.filter(
          (op) => !reducerFailedIds.has(op.id),
        );
        const isExactSuccessfulSubset =
          reportedCommittedOps.length === expectedCommittedOps.length &&
          reportedCommittedOps.every(
            (op, index) => op.id === expectedCommittedOps[index]?.id,
          );
        if (!isExactSuccessfulSubset) {
          reducerCommitCallbackError = new Error(
            'applyRemoteOperations: reducer-commit callback and failures must partition the entire appended batch in order.',
          );
          throw reducerCommitCallbackError;
        }
        reducerCommittedOps = expectedCommittedOps;

        reducerCommitPromise = (async () => {
          const reducerCommittedSeqs = expectedCommittedOps
            .map((op) => opIdToSeq.get(op.id))
            .filter((seq): seq is number => seq !== undefined);
          if (reducerCommittedSeqs.length !== expectedCommittedOps.length) {
            throw new Error(
              'applyRemoteOperations: reducer commit contained an operation outside the appended batch.',
            );
          }
          const reducerFailedOpIds = authoritativeReducerFailures.map(
            (failure) => failure.op.id,
          );
          if (reducerFailedOpIds.length > 0) {
            await store.markReducersCommittedAndMergeClocks(
              reducerCommittedSeqs,
              expectedCommittedOps,
              reducerFailedOpIds,
            );
          } else {
            await store.markReducersCommittedAndMergeClocks(
              reducerCommittedSeqs,
              expectedCommittedOps,
            );
          }
        })();
        return reducerCommitPromise;
      },
    });
  } catch (applyError) {
    // A valid first callback may already have started durable bookkeeping before
    // a duplicate callback (or another applier error) throws. Observe that
    // promise before propagating so it cannot become an unhandled rejection.
    await observeReducerCommitPromisePreservingPrimaryError();
    throw applyError;
  }
  if (reducerCommitCallbackError) {
    await observeReducerCommitPromisePreservingPrimaryError();
    throw reducerCommitCallbackError;
  }
  if (
    reducerCommitCallbackCount !== 1 ||
    reducerCommitPromise === undefined ||
    reducerCommittedOps === undefined ||
    reducerFailures === undefined
  ) {
    throw new Error(
      'applyRemoteOperations: applier did not invoke the reducer-commit callback.',
    );
  }
  // Also await host bookkeeping when an applier invoked the callback without
  // awaiting its returned promise. Pending ops must never be marked applied
  // before the reducer/archive checkpoint is durable.
  await reducerCommitPromise;
  const authoritativeReducerCommittedOps = reducerCommittedOps;
  const authoritativeReducerFailures = reducerFailures;

  const resultReducerFailures = getAuthoritativeReducerFailures(
    appendResult.writtenOps,
    applyResult.reducerFailures ?? [],
  );
  const hasMatchingReducerFailures =
    resultReducerFailures.length === authoritativeReducerFailures.length &&
    resultReducerFailures.every(
      (failure, index) => failure.op.id === authoritativeReducerFailures[index]?.op.id,
    );
  if (!hasMatchingReducerFailures) {
    throw new Error(
      'applyRemoteOperations: applier result must report the same reducer failures as the reducer-commit callback.',
    );
  }

  const appliedOpCount = applyResult.appliedOps.length;
  const hasExactAppliedPrefix =
    appliedOpCount <= authoritativeReducerCommittedOps.length &&
    applyResult.appliedOps.every(
      (op, index) => op.id === authoritativeReducerCommittedOps[index]?.id,
    );
  if (!hasExactAppliedPrefix) {
    throw new Error(
      'applyRemoteOperations: applied operations must be the exact ordered prefix of the reducer-committed operations.',
    );
  }

  const expectedFailedOp = authoritativeReducerCommittedOps[appliedOpCount];
  if (
    (applyResult.failedOp && applyResult.failedOp.op.id !== expectedFailedOp?.id) ||
    (!applyResult.failedOp && expectedFailedOp !== undefined)
  ) {
    const reportedFailedOpId = applyResult.failedOp?.op.id ?? 'none';
    const expectedFailedOpId = expectedFailedOp?.id ?? 'none';
    throw new Error(
      'applyRemoteOperations: applier must report the failed operation immediately after the applied prefix. ' +
        `Reported ${reportedFailedOpId}; expected ${expectedFailedOpId}.`,
    );
  }

  const authoritativeAppliedOps = authoritativeReducerCommittedOps.slice(
    0,
    appliedOpCount,
  );
  const authoritativeFailedOp = applyResult.failedOp
    ? {
        op: expectedFailedOp!,
        error: applyResult.failedOp.error,
      }
    : undefined;
  const appliedSeqs = authoritativeAppliedOps
    .map((op) => opIdToSeq.get(op.id))
    .filter((seq): seq is number => seq !== undefined);

  let clearedFullStateOpCount = 0;

  if (appliedSeqs.length > 0) {
    await store.markApplied(appliedSeqs);

    const appliedFullStateOpIds = authoritativeAppliedOps
      .filter(isFullStateOperation)
      .map((op) => op.id);

    if (appliedFullStateOpIds.length > 0) {
      // Exclude every full-state op of THIS batch, not only the applied ones:
      // a later full-state op whose reducers committed but whose archive
      // handling failed is still archive_pending/failed and must survive
      // cleanup so the retry path can finish it. Deleting it here would let
      // markFailed miss it and lose a change already visible at runtime on
      // the next startup replay.
      const batchFullStateOpIds = appendResult.writtenOps
        .filter(isFullStateOperation)
        .map((op) => op.id);
      clearedFullStateOpCount = await store.clearFullStateOpsExcept(batchFullStateOpIds);
    }
  }

  const failedOpIds = authoritativeFailedOp ? [authoritativeFailedOp.op.id] : [];
  const reducerFailedOpIds = authoritativeReducerFailures.map((failure) => failure.op.id);

  if (failedOpIds.length > 0) {
    await store.markFailed(failedOpIds);
  }

  return {
    appendedOps: appendResult.writtenOps,
    skippedCount: appendResult.skippedCount,
    appliedOps: authoritativeAppliedOps,
    appliedSeqs,
    clearedFullStateOpCount,
    failedOp: authoritativeFailedOp,
    failedOpIds,
    ...(authoritativeReducerFailures.length > 0
      ? { reducerFailures: authoritativeReducerFailures, reducerFailedOpIds }
      : {}),
  };
};

const getAuthoritativeReducerFailures = <TOperation extends Operation<string>>(
  writtenOps: TOperation[],
  reportedFailures: OperationApplyFailure<TOperation>[],
): OperationApplyFailure<TOperation>[] => {
  const writtenOpById = new Map(writtenOps.map((op) => [op.id, op]));
  const seenIds = new Set<string>();

  return reportedFailures.map((failure) => {
    const authoritativeOp = writtenOpById.get(failure.op.id);
    if (!authoritativeOp || seenIds.has(failure.op.id)) {
      throw new Error(
        `applyRemoteOperations: invalid reducer failure for operation ${failure.op.id}.`,
      );
    }
    seenIds.add(failure.op.id);
    return {
      op: authoritativeOp,
      error:
        failure.error instanceof Error ? failure.error : new Error(String(failure.error)),
    };
  });
};
