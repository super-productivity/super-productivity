import type {
  ApplyOperationsOptions,
  ApplyOperationsResult,
  OperationApplyFailure,
} from './apply.types';
import type { Operation } from './operation.types';
import type {
  ActionDispatchPort,
  ArchiveSideEffectPort,
  DeferredLocalActionsPort,
  RemoteApplyWindowPort,
  SyncActionLike,
} from './ports';

interface ReplayGlobals {
  setTimeout?: (handler: () => void, timeout?: number) => unknown;
}

export interface OperationReplayArchiveFailureContext<
  TOperation extends Operation<string> = Operation,
> {
  op: TOperation;
  processedCount: number;
  error: unknown;
}

export interface OperationReplayCoordinatorOptions<
  TOperation extends Operation<string> = Operation,
  TBulkAction extends SyncActionLike = SyncActionLike,
  TReplayAction extends SyncActionLike = SyncActionLike,
> {
  ops: TOperation[];
  applyOptions?: ApplyOperationsOptions;
  dispatcher: ActionDispatchPort<TBulkAction>;
  createBulkApplyAction: (ops: TOperation[]) => TBulkAction;
  /** Reads reducer failures captured synchronously during the bulk dispatch. */
  getReducerFailures?: () => OperationApplyFailure<TOperation>[];
  remoteApplyWindow: RemoteApplyWindowPort;
  deferredLocalActions: DeferredLocalActionsPort;
  archiveSideEffects?: ArchiveSideEffectPort<TReplayAction>;
  operationToAction?: (op: TOperation) => TReplayAction;
  isArchiveAffectingAction?: (action: TReplayAction) => boolean;
  onRemoteArchiveDataApplied?: () => void;
  onReducersCommitted?: (
    ops: TOperation[],
    failures: OperationApplyFailure<TOperation>[],
  ) => Promise<void>;
  onArchiveSideEffectError?: (
    context: OperationReplayArchiveFailureContext<TOperation>,
  ) => void;
  onPostSyncCooldownError?: (error: unknown) => void;
  yieldToEventLoop?: () => Promise<void>;
}

interface ArchiveSideEffectResult<TOperation extends Operation<string> = Operation> {
  appliedOps: TOperation[];
  hadArchiveAffectingOp: boolean;
  failedOp?: {
    op: TOperation;
    error: Error;
  };
}

const globals = (): ReplayGlobals => globalThis as unknown as ReplayGlobals;

export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    const setTimeoutFn = globals().setTimeout;
    if (setTimeoutFn === undefined) {
      void Promise.resolve().then(resolve);
      return;
    }
    setTimeoutFn(resolve, 0);
  });

/**
 * Replays an operation batch through host ports in the order required by sync.
 *
 * Host applications keep framework-specific action construction, operation
 * conversion, archive predicates, diagnostics, and UI notifications outside the
 * package. This coordinator only owns the generic ordering:
 *
 * 1. open the remote-apply window;
 * 2. dispatch the host's bulk replay action (skipped when the caller marks
 *    reducers as already committed via `skipReducerDispatch` — retry paths
 *    must not double-apply additive reducers);
 * 3. yield once, then exclude any host-reported reducer failures;
 * 4. checkpoint and run archive side effects only for reducer-successful ops;
 * 5. start post-sync cooldown before closing the remote-apply window;
 * 6. close the window and flush deferred local actions.
 */
export const replayOperationBatch = async <
  TOperation extends Operation<string> = Operation,
  TBulkAction extends SyncActionLike = SyncActionLike,
  TReplayAction extends SyncActionLike = SyncActionLike,
>({
  ops,
  applyOptions = {},
  dispatcher,
  createBulkApplyAction,
  getReducerFailures,
  remoteApplyWindow,
  deferredLocalActions,
  archiveSideEffects,
  operationToAction,
  isArchiveAffectingAction = () => false,
  onRemoteArchiveDataApplied,
  onReducersCommitted,
  onArchiveSideEffectError,
  onPostSyncCooldownError,
  yieldToEventLoop: waitForEventLoop = yieldToEventLoop,
}: OperationReplayCoordinatorOptions<TOperation, TBulkAction, TReplayAction>): Promise<
  ApplyOperationsResult<TOperation>
> => {
  if (ops.length === 0) {
    return { appliedOps: [] };
  }

  const isLocalHydration = applyOptions.isLocalHydration ?? false;
  const skipReducerDispatch = applyOptions.skipReducerDispatch ?? false;

  if (!isLocalHydration && archiveSideEffects !== undefined && !operationToAction) {
    throw new Error(
      'replayOperationBatch requires operationToAction when archiveSideEffects is provided.',
    );
  }

  remoteApplyWindow.startApplyingRemoteOps();
  let reducerCommittedOps = ops;
  let reducerFailures: OperationApplyFailure<TOperation>[] = [];
  try {
    if (!skipReducerDispatch) {
      dispatcher.dispatch(createBulkApplyAction(ops));
      await waitForEventLoop();
      reducerFailures = validateReducerFailures(ops, getReducerFailures?.() ?? []);
      const reducerFailedIds = new Set(reducerFailures.map((failure) => failure.op.id));
      reducerCommittedOps = ops.filter((op) => !reducerFailedIds.has(op.id));
      await onReducersCommitted?.(reducerCommittedOps, reducerFailures);
    }

    if (!isLocalHydration && archiveSideEffects !== undefined && operationToAction) {
      const archiveResult = await processArchiveSideEffects({
        ops: reducerCommittedOps,
        archiveSideEffects,
        operationToAction,
        isArchiveAffectingAction,
        onArchiveSideEffectError,
        yieldToEventLoop: waitForEventLoop,
      });

      if (archiveResult.failedOp) {
        return {
          appliedOps: archiveResult.appliedOps,
          failedOp: archiveResult.failedOp,
          ...(reducerFailures.length > 0 ? { reducerFailures } : {}),
        };
      }

      if (archiveResult.hadArchiveAffectingOp) {
        onRemoteArchiveDataApplied?.();
      }
    }
  } finally {
    if (!isLocalHydration) {
      try {
        remoteApplyWindow.startPostSyncCooldown();
      } catch (error) {
        onPostSyncCooldownError?.(error);
      }
    }

    remoteApplyWindow.endApplyingRemoteOps();
    await deferredLocalActions.processDeferredActions();
  }

  return {
    appliedOps: reducerCommittedOps,
    ...(reducerFailures.length > 0 ? { reducerFailures } : {}),
  };
};

const validateReducerFailures = <TOperation extends Operation<string>>(
  ops: TOperation[],
  reportedFailures: OperationApplyFailure<TOperation>[],
): OperationApplyFailure<TOperation>[] => {
  const opById = new Map(ops.map((op) => [op.id, op]));
  const seenIds = new Set<string>();

  return reportedFailures.map((failure) => {
    const authoritativeOp = opById.get(failure.op.id);
    if (!authoritativeOp) {
      throw new Error(
        `replayOperationBatch: reducer failure references unknown operation ${failure.op.id}.`,
      );
    }
    if (seenIds.has(failure.op.id)) {
      throw new Error(
        `replayOperationBatch: reducer failure reported more than once for ${failure.op.id}.`,
      );
    }
    seenIds.add(failure.op.id);
    return {
      op: authoritativeOp,
      error: toError(failure.error),
    };
  });
};

const processArchiveSideEffects = async <
  TOperation extends Operation<string>,
  TReplayAction extends SyncActionLike,
>({
  ops,
  archiveSideEffects,
  operationToAction,
  isArchiveAffectingAction,
  onArchiveSideEffectError,
  yieldToEventLoop: waitForEventLoop,
}: {
  ops: TOperation[];
  archiveSideEffects: ArchiveSideEffectPort<TReplayAction>;
  operationToAction: (op: TOperation) => TReplayAction;
  isArchiveAffectingAction: (action: TReplayAction) => boolean;
  onArchiveSideEffectError?: (
    context: OperationReplayArchiveFailureContext<TOperation>,
  ) => void;
  yieldToEventLoop: () => Promise<void>;
}): Promise<ArchiveSideEffectResult<TOperation>> => {
  const appliedOps: TOperation[] = [];
  let hadArchiveAffectingOp = false;

  for (const op of ops) {
    try {
      const action = operationToAction(op);
      await archiveSideEffects.handleOperation(action);

      if (isArchiveAffectingAction(action)) {
        hadArchiveAffectingOp = true;
        await waitForEventLoop();
      }

      appliedOps.push(op);
    } catch (error) {
      onArchiveSideEffectError?.({
        op,
        processedCount: appliedOps.length,
        error,
      });

      return {
        appliedOps,
        hadArchiveAffectingOp,
        failedOp: {
          op,
          error: toError(error),
        },
      };
    }
  }

  await waitForEventLoop();

  return {
    appliedOps,
    hadArchiveAffectingOp,
  };
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));
