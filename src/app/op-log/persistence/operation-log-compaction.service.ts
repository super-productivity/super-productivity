import { inject, Injectable } from '@angular/core';
import { LockService } from '../sync/lock.service';
import {
  COMPACTION_RETENTION_MS,
  COMPACTION_TIMEOUT_MS,
  EMERGENCY_COMPACTION_RETENTION_MS,
  LOCK_NAMES,
  SLOW_COMPACTION_THRESHOLD_MS,
} from '../core/operation-log.const';
import { OperationLogStoreService } from './operation-log-store.service';
import { StateSnapshotService, AppStateSnapshot } from '../backup/state-snapshot.service';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { OpLog } from '../../core/log';

/**
 * Manages the compaction (garbage collection) of the operation log.
 * To prevent the log from growing indefinitely, this service periodically
 * creates a complete snapshot of the current application state and stores it
 * in IndexedDB. It then deletes old operations from the log that are already
 * reflected in the snapshot and have been successfully synced (if applicable)
 * and are older than a defined retention window.
 */
@Injectable({ providedIn: 'root' })
export class OperationLogCompactionService {
  private opLogStore = inject(OperationLogStoreService);
  private lockService = inject(LockService);
  private stateSnapshot = inject(StateSnapshotService);
  private vectorClockService = inject(VectorClockService);

  async compact(): Promise<void> {
    await this._doCompact(COMPACTION_RETENTION_MS, false);
  }

  /**
   * Emergency compaction triggered when storage quota is exceeded.
   * Uses a shorter retention window (1 day instead of 7) to free more space.
   * Returns true if compaction succeeded, false otherwise.
   */
  async emergencyCompact(): Promise<boolean> {
    try {
      await this._doCompact(EMERGENCY_COMPACTION_RETENTION_MS, true);
      return true;
    } catch (e) {
      OpLog.err('OperationLogCompactionService: Emergency compaction failed', e);
      return false;
    }
  }

  /**
   * Core compaction logic shared between regular and emergency compaction.
   * @param retentionMs - How long to keep synced operations (in ms)
   * @param isEmergency - Whether this is an emergency compaction (for logging)
   */
  private async _doCompact(retentionMs: number, isEmergency: boolean): Promise<void> {
    await this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      const startTime = Date.now();
      const label = isEmergency ? 'emergency ' : '';

      // 1. Get current state from NgRx store
      const currentState = this.stateSnapshot.getStateSnapshot();
      this.checkCompactionTimeout(startTime, `${label}state snapshot`);

      // 2. Get current vector clock (max of all ops)
      const currentVectorClock = await this.vectorClockService.getCurrentVectorClock();
      this.checkCompactionTimeout(startTime, `${label}vector clock`);

      // 3. Get lastSeq IMMEDIATELY before writing cache to minimize race window
      // This ensures new ops written after this point have seq > lastSeq
      const lastSeq = await this.opLogStore.getLastSeq();

      // 4. Extract entity keys for conflict detection after compaction
      // This allows us to distinguish between entities that existed at snapshot time
      // vs new entities created later - critical for correct vector clock comparison
      const snapshotEntityKeys = this._extractEntityKeysFromState(currentState);

      // 5. Write to state cache with schema version and entity keys
      await this.opLogStore.saveStateCache({
        state: currentState,
        lastAppliedOpSeq: lastSeq,
        vectorClock: currentVectorClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        snapshotEntityKeys,
      });

      // After snapshot is saved, new operations with seq > lastSeq won't be deleted

      // 6. Reset compaction counter (persistent across tabs/restarts)
      await this.opLogStore.resetCompactionCounter();

      // 7. Delete old operations (keep recent for conflict resolution window)
      // Only delete ops that have been synced to remote
      const cutoff = Date.now() - retentionMs;

      await this.opLogStore.deleteOpsWhere(
        (entry) =>
          !!entry.syncedAt && // never drop unsynced ops
          entry.appliedAt < cutoff &&
          entry.seq <= lastSeq, // keep tail for conflict frontier
      );

      // Log metrics for slow compaction or emergency compaction
      const totalDuration = Date.now() - startTime;
      if (totalDuration > SLOW_COMPACTION_THRESHOLD_MS || isEmergency) {
        OpLog.normal('OperationLogCompactionService: Compaction completed', {
          durationMs: totalDuration,
          entityCount: snapshotEntityKeys.length,
          isEmergency,
        });
      }
    });
  }

  /**
   * Checks if compaction has exceeded the timeout threshold.
   * If exceeded, throws an error to abort compaction before the lock expires.
   * This prevents data corruption from concurrent access.
   */
  private checkCompactionTimeout(startTime: number, phase: string): void {
    const elapsed = Date.now() - startTime;
    if (elapsed > COMPACTION_TIMEOUT_MS) {
      throw new Error(
        `Compaction timeout after ${elapsed}ms during ${phase}. ` +
          `Aborting to prevent lock expiration. ` +
          `Consider reducing state size or increasing timeout.`,
      );
    }
  }

  /**
   * Extracts all entity keys from the state snapshot.
   * Used for conflict detection to distinguish between entities that existed
   * at snapshot time vs new entities created later on other clients.
   *
   * Format: "ENTITY_TYPE:entityId" (e.g., "TASK:abc123", "PROJECT:xyz789")
   */
  private _extractEntityKeysFromState(state: AppStateSnapshot): string[] {
    const keys: string[] = [];

    // Entity adapter states (have ids array)
    // Cast to expected type - we know NgRx entity adapter states have ids array
    type EntityState = { ids?: (string | number)[] } | undefined;
    const entityStates: Array<{
      key: string;
      state: EntityState;
    }> = [
      { key: 'TASK', state: state.task as EntityState },
      { key: 'PROJECT', state: state.project as EntityState },
      { key: 'TAG', state: state.tag as EntityState },
      { key: 'NOTE', state: state.note as EntityState },
      { key: 'ISSUE_PROVIDER', state: state.issueProvider as EntityState },
      { key: 'SIMPLE_COUNTER', state: state.simpleCounter as EntityState },
      { key: 'TASK_REPEAT_CFG', state: state.taskRepeatCfg as EntityState },
      { key: 'METRIC', state: state.metric as EntityState },
    ];

    for (const { key, state: entityState } of entityStates) {
      if (entityState?.ids) {
        for (const id of entityState.ids) {
          keys.push(`${key}:${id}`);
        }
      }
    }

    // Reminders are an array, not an entity adapter state
    if (Array.isArray(state.reminders)) {
      for (const reminder of state.reminders) {
        if (reminder?.id) {
          keys.push(`REMINDER:${reminder.id}`);
        }
      }
    }

    // Plugin User Data (Array)
    if (Array.isArray(state.pluginUserData)) {
      for (const item of state.pluginUserData) {
        if (item?.id) {
          keys.push(`PLUGIN_USER_DATA:${item.id}`);
        }
      }
    }

    // Plugin Metadata (Array)
    if (Array.isArray(state.pluginMetadata)) {
      for (const item of state.pluginMetadata) {
        if (item?.id) {
          keys.push(`PLUGIN_METADATA:${item.id}`);
        }
      }
    }

    // Boards have a different structure: { boardCfgs: BoardCfg[] }
    type BoardsState = { boardCfgs?: Array<{ id?: string }> } | undefined;
    const boardsState = state.boards as BoardsState;
    if (boardsState?.boardCfgs && Array.isArray(boardsState.boardCfgs)) {
      for (const board of boardsState.boardCfgs) {
        if (board?.id) {
          keys.push(`BOARD:${board.id}`);
        }
      }
    }

    // Singleton states (single entity with fixed ID)
    // These always exist and are identified by their type
    if (state.globalConfig) {
      keys.push('GLOBAL_CONFIG:GLOBAL_CONFIG');
    }
    if (state.planner) {
      keys.push('PLANNER:PLANNER');
    }
    if (state.menuTree) {
      keys.push('MENU_TREE:MENU_TREE');
    }
    if (state.timeTracking) {
      keys.push('TIME_TRACKING:TIME_TRACKING');
    }

    // Archive entities (nested task states)
    // These share the TASK entity type since archived tasks are still tasks
    if (state.archiveYoung?.task?.ids) {
      for (const id of state.archiveYoung.task.ids) {
        keys.push(`TASK:${id}`);
      }
    }
    if (state.archiveOld?.task?.ids) {
      for (const id of state.archiveOld.task.ids) {
        keys.push(`TASK:${id}`);
      }
    }

    return keys;
  }
}
