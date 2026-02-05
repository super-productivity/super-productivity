import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClock, EntityType } from '../core/operation.types';
import { mergeVectorClocks } from '../../core/util/vector-clock';
import { toEntityKey } from '../util/entity-key.util';

/**
 * Service for managing vector clocks in the operation log system.
 *
 * ## What Vector Clocks Represent
 *
 * A vector clock is a map of `{ clientId: counter }` entries that tracks
 * the causal history of operations. Each client increments its own counter
 * when creating operations, allowing us to determine:
 * - Which operations happened before others (causality)
 * - Which operations are concurrent (potential conflicts)
 * - Whether a state is up-to-date with respect to another
 *
 * ## Types of Vector Clocks
 *
 * 1. **Global Vector Clock**: The merged clock from the snapshot plus all
 *    subsequent operations. Represents "everything this client knows about".
 *    Use for: Determining overall sync state, generating new operation clocks.
 *
 * 2. **Entity Frontier**: Per-entity vector clocks tracking the latest
 *    operation for each entity. More granular than global clock.
 *    Use for: Conflict detection on specific entities.
 *
 * ## Effect of Compaction
 *
 * When operations are compacted into a snapshot:
 * - The snapshot stores the global vector clock at compaction time
 * - Individual operation vector clocks are lost (ops are deleted)
 * - Entity frontiers before compaction are approximated by the snapshot clock
 *
 * This means after compaction, we lose per-entity granularity for older
 * operations. The snapshot clock serves as a conservative baseline.
 */
@Injectable({
  providedIn: 'root',
})
export class VectorClockService {
  private opLogStore = inject(OperationLogStoreService);

  /**
   * Gets the current global vector clock.
   *
   * PERF OPTIMIZATION: First tries to read from the vector_clock store in SUP_OPS,
   * which is the authoritative source updated atomically with each operation.
   * Falls back to computing from snapshot + ops for migration/recovery scenarios.
   *
   * This represents "everything this client knows about" and should be used
   * when generating new operations or determining overall sync state.
   *
   * @returns The merged vector clock representing current knowledge
   */
  async getCurrentVectorClock(): Promise<VectorClock> {
    // Try the vector_clock store first (fast path, authoritative source)
    const storedClock = await this.opLogStore.getVectorClock();
    if (storedClock !== null) {
      return storedClock;
    }

    // Fallback: compute from snapshot + ops (for migration or when store is empty)
    // Load snapshot (if exists)
    const snapshot = await this.opLogStore.loadStateCache();
    let clock = snapshot ? { ...snapshot.vectorClock } : {};

    // Get ops after snapshot
    const seq = snapshot ? snapshot.lastAppliedOpSeq : 0;
    const ops = await this.opLogStore.getOpsAfterSeq(seq);

    // Merge all op clocks to get the max for each client
    // This is correct because each op carries the vector clock state
    // after that operation was applied.
    for (const entry of ops) {
      clock = mergeVectorClocks(clock, entry.op.vectorClock);
    }

    return clock;
  }

  /**
   * Gets a full vector clock by merging ALL ops in IndexedDB from seq 0.
   *
   * Use this as a fallback when normal clock computation fails due to
   * snapshot corruption or incomplete compaction. This is more expensive
   * than getCurrentVectorClock() but guarantees we include all known clocks.
   *
   * @returns The merged vector clock from all stored operations
   */
  async getFullVectorClock(): Promise<VectorClock> {
    // Start with snapshot clock (if exists)
    const snapshot = await this.opLogStore.loadStateCache();
    let clock = snapshot ? { ...snapshot.vectorClock } : {};

    // Get ALL ops from seq 0, not just after snapshot
    // This ensures we catch any clock entries that might have been
    // missed if the snapshot's vectorClock was incomplete
    const allOps = await this.opLogStore.getOpsAfterSeq(0);

    // Merge all op clocks
    for (const entry of allOps) {
      clock = mergeVectorClocks(clock, entry.op.vectorClock);
    }

    return clock;
  }

  /**
   * Gets the snapshot's vector clock, which serves as a baseline for entities
   * that haven't been modified since compaction.
   *
   * Use this as a fallback when no per-entity frontier exists to prevent
   * false conflicts for entities modified before compaction.
   *
   * @returns The snapshot vector clock, or undefined if no snapshot exists
   */
  async getSnapshotVectorClock(): Promise<VectorClock | undefined> {
    const snapshot = await this.opLogStore.loadStateCache();
    return snapshot?.vectorClock;
  }

  /**
   * Gets the set of entity keys that existed at snapshot (compaction) time.
   *
   * This is critical for conflict detection: when a remote operation arrives
   * for an entity, we need to know whether that entity existed at snapshot time:
   * - If YES: use the snapshot vector clock as the baseline for comparison
   * - If NO: use an empty clock (the entity is new, so any remote op is valid)
   *
   * Without this distinction, new entities created on other clients after
   * compaction could be incorrectly rejected as "superseded" because the snapshot
   * clock contains high counters from unrelated work.
   *
   * @returns Set of entity keys, or undefined if snapshot doesn't have this data
   */
  async getSnapshotEntityKeys(): Promise<Set<string> | undefined> {
    const snapshot = await this.opLogStore.loadStateCache();
    if (!snapshot?.snapshotEntityKeys) {
      return undefined;
    }
    return new Set(snapshot.snapshotEntityKeys);
  }

  /**
   * Gets the entity frontier - a map of entity keys to their latest vector clocks.
   *
   * The frontier tracks the most recent operation for each entity, enabling
   * fine-grained conflict detection. An entity key is formatted as
   * `"entityType:entityId"` (e.g., `"TASK:abc123"`).
   *
   * Note: After compaction, entities modified before the snapshot will NOT
   * have entries in this map. Use `getSnapshotVectorClock()` as a fallback
   * baseline for such entities.
   *
   * @param entityType - Optional: Filter to specific entity type
   * @param entityId - Optional: Filter to specific entity ID
   * @returns Map of entity keys to their latest vector clocks
   */
  async getEntityFrontier(
    entityType?: EntityType,
    entityId?: string,
  ): Promise<Map<string, VectorClock>> {
    const map = new Map<string, VectorClock>();

    // Get snapshot to determine where to start scanning
    const snapshot = await this.opLogStore.loadStateCache();
    const ops = await this.opLogStore.getOpsAfterSeq(snapshot?.lastAppliedOpSeq || 0);

    // Build frontier from ops after snapshot
    // The last op for each entity determines its frontier
    for (const entry of ops) {
      // Skip rejected ops - they shouldn't affect the frontier
      if (entry.rejectedAt) continue;

      const ids = entry.op.entityIds?.length
        ? entry.op.entityIds
        : entry.op.entityId
          ? [entry.op.entityId]
          : [];

      for (const id of ids) {
        if (entityType && entry.op.entityType !== entityType) continue;
        if (entityId && id !== entityId) continue;

        const key = toEntityKey(entry.op.entityType, id);
        map.set(key, entry.op.vectorClock);
      }
    }

    return map;
  }
}
