import { compareVectorClocks } from './vector-clock';
import type { VectorClock, VectorClockComparison } from './vector-clock';

export type SyncImportFilterKeepReason =
  | 'greater-than'
  | 'equal'
  | 'same-client-post-import'
  | 'knows-import-counter';

export type SyncImportFilterInvalidateReason = 'concurrent' | 'less-than';

export type SyncImportFilterDecisionReason =
  | SyncImportFilterKeepReason
  | SyncImportFilterInvalidateReason;

export interface SyncImportFilterClockSource {
  clientId: string;
  vectorClock: VectorClock;
}

export interface SyncImportFilterDecision {
  shouldKeep: boolean;
  comparison: VectorClockComparison;
  reason: SyncImportFilterDecisionReason;
}

/**
 * Classifies whether an operation survives a full-state import's clean-slate
 * boundary using only vector-clock causality.
 */
export const classifyOpAgainstSyncImport = (
  op: SyncImportFilterClockSource,
  latestImport: SyncImportFilterClockSource,
): SyncImportFilterDecision => {
  const comparison = compareVectorClocks(op.vectorClock, latestImport.vectorClock);

  if (comparison === 'GREATER_THAN') {
    return { shouldKeep: true, comparison, reason: 'greater-than' };
  }

  if (comparison === 'EQUAL') {
    return { shouldKeep: true, comparison, reason: 'equal' };
  }

  if (comparison === 'CONCURRENT') {
    const importClientCounter = latestImport.vectorClock[latestImport.clientId] ?? 0;

    if (
      op.clientId === latestImport.clientId &&
      (op.vectorClock[op.clientId] ?? 0) > importClientCounter
    ) {
      return { shouldKeep: true, comparison, reason: 'same-client-post-import' };
    }

    if (
      op.clientId !== latestImport.clientId &&
      (op.vectorClock[latestImport.clientId] ?? 0) >= importClientCounter &&
      importClientCounter > 0
    ) {
      return { shouldKeep: true, comparison, reason: 'knows-import-counter' };
    }

    return { shouldKeep: false, comparison, reason: 'concurrent' };
  }

  return { shouldKeep: false, comparison, reason: 'less-than' };
};
