import { Operation } from '../core/operation.types';

/**
 * Splits downloaded ops into those a file snapshot already contains and those
 * that came after it. Without a snapshot id list, every op counts as included.
 */
export const partitionSnapshotOps = (
  ops: Operation[],
  snapshotAppliedOpIds: string[] | undefined,
): { snapshotIncludedOps: Operation[]; postSnapshotOps: Operation[] } => {
  if (snapshotAppliedOpIds === undefined) {
    return { snapshotIncludedOps: ops, postSnapshotOps: [] };
  }
  const includedIds = new Set(snapshotAppliedOpIds);
  return {
    snapshotIncludedOps: ops.filter((op) => includedIds.has(op.id)),
    postSnapshotOps: ops.filter((op) => !includedIds.has(op.id)),
  };
};
