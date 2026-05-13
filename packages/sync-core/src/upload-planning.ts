import type { Operation, OperationLogEntry } from './operation.types';

export interface RegularOpsAfterFullStateUploadPlan<
  TEntry extends OperationLogEntry<Operation<string>> = OperationLogEntry,
> {
  opsIncludedInSnapshot: TEntry[];
  opsAfterSnapshot: TEntry[];
}

export interface PlanRegularOpsAfterFullStateUploadOptions<
  TEntry extends OperationLogEntry<Operation<string>> = OperationLogEntry,
> {
  regularOps: TEntry[];
  lastUploadedFullStateOpId?: string;
}

/**
 * Splits regular operations around an uploaded full-state snapshot.
 *
 * UUIDv7 operation IDs are time-ordered in Super Productivity. Core only
 * depends on lexical ID ordering supplied by the host. Ops before the full-state
 * operation are already represented in the snapshot and can be marked synced;
 * later ops still need the normal upload path.
 */
export const planRegularOpsAfterFullStateUpload = <
  TEntry extends OperationLogEntry<Operation<string>> = OperationLogEntry,
>({
  regularOps,
  lastUploadedFullStateOpId,
}: PlanRegularOpsAfterFullStateUploadOptions<TEntry>): RegularOpsAfterFullStateUploadPlan<TEntry> => {
  if (!lastUploadedFullStateOpId) {
    return {
      opsIncludedInSnapshot: [],
      opsAfterSnapshot: regularOps,
    };
  }

  const opsIncludedInSnapshot: TEntry[] = [];
  const opsAfterSnapshot: TEntry[] = [];

  for (const entry of regularOps) {
    if (entry.op.id < lastUploadedFullStateOpId) {
      opsIncludedInSnapshot.push(entry);
    } else {
      opsAfterSnapshot.push(entry);
    }
  }

  return { opsIncludedInSnapshot, opsAfterSnapshot };
};

export type UploadLastServerSeqUpdateReason =
  | 'complete'
  | 'has-more-with-piggyback'
  | 'has-more-empty';

export interface PlanUploadLastServerSeqUpdateOptions {
  currentHighestReceivedSeq: number;
  responseLatestSeq: number;
  hasMorePiggyback: boolean;
  piggybackServerSeqs: number[];
}

export interface UploadLastServerSeqUpdatePlan {
  seqToStore: number;
  highestReceivedSeq: number;
  hasMorePiggyback: boolean;
  reason: UploadLastServerSeqUpdateReason;
}

/**
 * Plans the client-side last-server-sequence update after an upload response.
 *
 * When the server indicates more piggybacked ops are available, callers must
 * advance only to the highest piggybacked sequence actually received. This
 * keeps the follow-up download able to fetch the remaining remote ops. Across
 * chunks the stored sequence must never regress.
 */
export const planUploadLastServerSeqUpdate = ({
  currentHighestReceivedSeq,
  responseLatestSeq,
  hasMorePiggyback,
  piggybackServerSeqs,
}: PlanUploadLastServerSeqUpdateOptions): UploadLastServerSeqUpdatePlan => {
  if (hasMorePiggyback) {
    if (piggybackServerSeqs.length > 0) {
      const maxPiggybackSeq = Math.max(...piggybackServerSeqs);
      const highestReceivedSeq = Math.max(currentHighestReceivedSeq, maxPiggybackSeq);
      return {
        seqToStore: highestReceivedSeq,
        highestReceivedSeq,
        hasMorePiggyback: true,
        reason: 'has-more-with-piggyback',
      };
    }

    return {
      seqToStore: currentHighestReceivedSeq,
      highestReceivedSeq: currentHighestReceivedSeq,
      hasMorePiggyback: true,
      reason: 'has-more-empty',
    };
  }

  const highestReceivedSeq = Math.max(currentHighestReceivedSeq, responseLatestSeq);
  return {
    seqToStore: highestReceivedSeq,
    highestReceivedSeq,
    hasMorePiggyback: false,
    reason: 'complete',
  };
};
