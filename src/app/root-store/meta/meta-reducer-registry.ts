import { MetaReducer } from '@ngrx/store';
import { isDevMode } from '@angular/core';
import { operationCaptureMetaReducer } from '../../op-log/capture/operation-capture.meta-reducer';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { undoTaskDeleteMetaReducer } from './undo-task-delete.meta-reducer';
import { taskSharedCrudMetaReducer } from './task-shared-meta-reducers/task-shared-crud.reducer';
import { taskBatchUpdateMetaReducer } from './task-shared-meta-reducers/task-batch-update.reducer';
import { taskSharedLifecycleMetaReducer } from './task-shared-meta-reducers/task-shared-lifecycle.reducer';
import { taskSharedSchedulingMetaReducer } from './task-shared-meta-reducers/task-shared-scheduling.reducer';
import { projectSharedMetaReducer } from './task-shared-meta-reducers/project-shared.reducer';
import { tagSharedMetaReducer } from './task-shared-meta-reducers/tag-shared.reducer';
import { issueProviderSharedMetaReducer } from './task-shared-meta-reducers/issue-provider-shared.reducer';
import { taskRepeatCfgSharedMetaReducer } from './task-shared-meta-reducers/task-repeat-cfg-shared.reducer';
import { plannerSharedMetaReducer } from './task-shared-meta-reducers/planner-shared.reducer';
import { shortSyntaxSharedMetaReducer } from './task-shared-meta-reducers/short-syntax-shared.reducer';
import { lwwUpdateMetaReducer } from './task-shared-meta-reducers/lww-update.meta-reducer';
import { actionLoggerReducer } from './action-logger.reducer';

/**
 * Meta-Reducer Registry
 *
 * ORDERING IS CRITICAL - DO NOT REORDER WITHOUT UNDERSTANDING THE CONSEQUENCES
 *
 * NgRx composes meta-reducers such that FIRST in array = OUTERMOST in call chain.
 * This means: Phase 1 runs first on the way IN and last on the way OUT.
 *
 * ## Phase 1: Operation Capture (MUST BE FIRST)
 * Captures the original state BEFORE any modifications for operation logging.
 * If moved, operation logs will capture post-modification state (wrong!).
 *
 * ## Phase 2: Bulk Operations
 * Unwraps bulk dispatches for hydration/sync into individual actions.
 * Must run early so all subsequent meta-reducers see individual actions.
 *
 * ## Phase 3: Undo/Delete Capture
 * Captures task context before deletion for undo functionality.
 * Must run before CRUD operations that actually delete.
 *
 * ## Phase 4: Core CRUD Operations
 * Task add/update/delete with project & tag cleanup.
 * These run in dependency order:
 * - taskSharedCrud: Basic CRUD with cascades
 * - taskBatchUpdate: Plugin API batch operations
 * - taskSharedLifecycle: Archive/restore
 * - taskSharedScheduling: Due dates and TODAY_TAG
 *
 * ## Phase 5: Entity-Specific Operations
 * Handle deletion cascades for specific entity types.
 * Order within phase is less critical.
 * - projectShared: Project deletion → task/time-tracking cleanup
 * - tagShared: Tag deletion → task/repeat-cfg/time-tracking cleanup
 * - issueProviderShared: Issue provider unlinking
 * - taskRepeatCfgShared: Repeat config unlinking
 *
 * ## Phase 6: Planner Synchronization
 * Must run AFTER scheduling to see final task.dueDay values.
 * Syncs planner days with TODAY_TAG.
 *
 * ## Phase 7: Synthetic Multi-Step Operations
 * - shortSyntax: Combines multiple operations atomically
 * - lwwUpdate: Conflict resolution entity replacement
 * Must run LAST (before logging) to handle composed operations.
 *
 * ## Phase 8: Logging (MUST BE LAST)
 * Pure logging, no state changes.
 */
export const META_REDUCERS: MetaReducer[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: OPERATION CAPTURE (MUST BE FIRST - OUTERMOST)
  // ═══════════════════════════════════════════════════════════════════════════
  // Captures original state BEFORE any other meta-reducer modifies it.
  // Critical for operation logging - if moved, logs will have wrong before-state.
  operationCaptureMetaReducer,

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  // Unwraps BulkDispatch actions for:
  // - Fast startup (local hydration)
  // - Remote sync (operations from other clients)
  // Must run early so all subsequent reducers see individual actions.
  bulkOperationsMetaReducer,

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: UNDO/DELETE CAPTURE
  // ═══════════════════════════════════════════════════════════════════════════
  // Captures task context before deletion for undo/restore.
  undoTaskDeleteMetaReducer,

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: CORE CRUD OPERATIONS (Ordered by dependency)
  // ═══════════════════════════════════════════════════════════════════════════
  taskSharedCrudMetaReducer, // Add/update/delete with project & tag cleanup
  taskBatchUpdateMetaReducer, // Plugin API batch operations
  taskSharedLifecycleMetaReducer, // Archive/restore operations
  taskSharedSchedulingMetaReducer, // Due dates, times, TODAY_TAG management

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: ENTITY-SPECIFIC CASCADES (Order-independent within phase)
  // ═══════════════════════════════════════════════════════════════════════════
  projectSharedMetaReducer, // Project deletion → cleanup tasks, time-tracking
  tagSharedMetaReducer, // Tag deletion → cleanup tasks, repeat-cfgs, time-tracking
  issueProviderSharedMetaReducer, // Issue provider unlinking
  taskRepeatCfgSharedMetaReducer, // Repeat config unlinking

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: PLANNER SYNCHRONIZATION (Must run AFTER scheduling)
  // ═══════════════════════════════════════════════════════════════════════════
  plannerSharedMetaReducer, // Syncs planner days with task.dueDay and TODAY_TAG

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7: SYNTHETIC MULTI-STEP OPERATIONS (Must run late)
  // ═══════════════════════════════════════════════════════════════════════════
  shortSyntaxSharedMetaReducer, // Atomic multi-step short syntax operations
  lwwUpdateMetaReducer, // Conflict resolution entity replacement

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 8: LOGGING (MUST BE LAST - INNERMOST)
  // ═══════════════════════════════════════════════════════════════════════════
  actionLoggerReducer,
];

/**
 * Validates critical meta-reducer ordering constraints in development mode.
 * Throws an error if constraints are violated to catch issues during development.
 *
 * Critical constraints:
 * 1. operationCaptureMetaReducer MUST be at index 0 (captures state BEFORE any modifications)
 * 2. bulkOperationsMetaReducer MUST be at index 1 (unwraps bulk dispatches early)
 * 3. actionLoggerReducer MUST be last (pure logging after all modifications)
 */
const validateMetaReducerOrdering = (): void => {
  if (!isDevMode()) {
    return;
  }

  const errors: string[] = [];

  // Check operationCaptureMetaReducer is first
  if (META_REDUCERS[0] !== operationCaptureMetaReducer) {
    errors.push(
      'operationCaptureMetaReducer MUST be at index 0 to capture state before modifications',
    );
  }

  // Check bulkOperationsMetaReducer is second
  if (META_REDUCERS[1] !== bulkOperationsMetaReducer) {
    errors.push(
      'bulkOperationsMetaReducer MUST be at index 1 to unwrap bulk dispatches early',
    );
  }

  // Check actionLoggerReducer is last
  if (META_REDUCERS[META_REDUCERS.length - 1] !== actionLoggerReducer) {
    errors.push(
      'actionLoggerReducer MUST be last for pure logging after all modifications',
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Meta-reducer ordering validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n\n` +
        'See meta-reducer-registry.ts for ordering documentation.',
    );
  }
};

// Run validation when module loads (development mode only)
validateMetaReducerOrdering();
