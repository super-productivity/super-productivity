import type { Operation } from './operation.types';
import { NOOP_SYNC_LOGGER } from './sync-logger';
import type { SyncLogger } from './sync-logger';
import { mergeVectorClocks } from './vector-clock';
import type { VectorClock, VectorClockComparison } from './vector-clock';

export interface EntityFrontierContext {
  localOpsForEntity: Pick<Operation<string>, 'vectorClock'>[];
  appliedFrontier: VectorClock | undefined;
  snapshotVectorClock: VectorClock | undefined;
  snapshotEntityKeys: ReadonlySet<string> | undefined;
}

export interface ClockCorruptionAdjustmentOptions {
  comparison: VectorClockComparison;
  entityKey: string;
  pendingOpsCount: number;
  hasNoSnapshotClock: boolean;
  localFrontierIsEmpty: boolean;
  logger?: SyncLogger;
  onPotentialCorruption?: (message: string) => void;
}

/**
 * Builds the local frontier vector clock for one entity.
 *
 * Snapshot clocks only apply to entities known to exist at snapshot time. For
 * old snapshots without `snapshotEntityKeys`, the applied frontier is the only
 * evidence that the entity existed locally.
 */
export const buildEntityFrontier = (
  entityKey: string,
  ctx: EntityFrontierContext,
): VectorClock => {
  const entityExistedAtSnapshot = ctx.snapshotEntityKeys
    ? ctx.snapshotEntityKeys.has(entityKey)
    : ctx.appliedFrontier !== undefined;
  const fallbackClock = entityExistedAtSnapshot ? ctx.snapshotVectorClock : {};
  const baselineClock = ctx.appliedFrontier || fallbackClock || {};

  const allClocks = [baselineClock, ...ctx.localOpsForEntity.map((op) => op.vectorClock)];
  return allClocks.reduce((acc, clock) => mergeVectorClocks(acc, clock), {});
};

/**
 * Converts unsafe vector-clock comparisons to CONCURRENT when per-entity clock
 * data appears corrupted. CONCURRENT forces conflict resolution instead of
 * silently skipping either side.
 */
export const adjustForClockCorruption = ({
  comparison,
  entityKey,
  pendingOpsCount,
  hasNoSnapshotClock,
  localFrontierIsEmpty,
  logger = NOOP_SYNC_LOGGER,
  onPotentialCorruption,
}: ClockCorruptionAdjustmentOptions): VectorClockComparison => {
  const potentialCorruption =
    pendingOpsCount > 0 && hasNoSnapshotClock && localFrontierIsEmpty;

  if (potentialCorruption) {
    onPotentialCorruption?.(
      `Clock corruption detected for entity ${entityKey}: ` +
        `has ${pendingOpsCount} pending ops but no snapshot clock and empty local frontier`,
    );
  }

  if (potentialCorruption && comparison === 'LESS_THAN') {
    logger.warn('sync-core: converting LESS_THAN to CONCURRENT for clock corruption', {
      entityKey,
      pendingOpsCount,
    });
    return 'CONCURRENT';
  }

  if (potentialCorruption && comparison === 'GREATER_THAN') {
    logger.warn('sync-core: converting GREATER_THAN to CONCURRENT for clock corruption', {
      entityKey,
      pendingOpsCount,
    });
    return 'CONCURRENT';
  }

  return comparison;
};
