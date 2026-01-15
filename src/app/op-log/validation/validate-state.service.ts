import { inject, Injectable } from '@angular/core';
import { IValidation } from 'typia';
import { validateFull } from './validation-fn';
// TEMPORARILY DISABLED - repair is disabled for debugging
// import { dataRepair } from './data-repair';
// import { isDataRepairPossible } from './is-data-repair-possible.util';
import { RepairSummary } from '../core/operation.types';
import { OpLog } from '../../core/log';
// DISABLED: Repair system is non-functional
// import { RepairOperationService } from './repair-operation.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
// DISABLED: Repair system is non-functional
// import { SyncService } from '../../sync/sync.service';
// import { loadAllData } from '../../root-store/meta/load-all-data.action';

/* DISABLED: Repair system helper types and functions - unused while repair is disabled
interface EntityState<T = unknown> { ids: string[]; entities: Record<string, T>; }

const getEntityState = (
  state: AppDataComplete,
  model: 'task' | 'project' | 'tag' | 'note' | 'simpleCounter',
): EntityState | undefined => { ... };

const getArchiveEntityState = (
  state: AppDataComplete,
  archiveType: 'archiveYoung' | 'archiveOld',
): EntityState | undefined => { ... };

interface TaskEntity { id: string; projectId?: string; tagIds?: string[]; }

const getTaskEntities = (state: AppDataComplete): Record<string, TaskEntity> => { ... };

interface MenuTreeStateLocal { projectTree?: unknown[]; tagTree?: unknown[]; }
*/

/**
 * Result of validating application state.
 */
export interface StateValidationResult {
  isValid: boolean;
  typiaErrors: unknown[];
  crossModelError?: string;
}

/**
 * Result of validating and repairing application state.
 */
export interface ValidateAndRepairResult {
  isValid: boolean;
  wasRepaired: boolean;
  repairedState?: Record<string, unknown>;
  repairSummary?: RepairSummary;
  error?: string;
  crossModelError?: string;
}

/**
 * Service for validating and repairing application state.
 * Wraps validation (Typia + cross-model) and repair functionality.
 *
 * Validation happens at key checkpoints:
 * - Checkpoint B: After loading snapshot during hydration
 * - Checkpoint C: After replaying tail operations during hydration
 * - Checkpoint D: After applying remote operations during sync
 */
@Injectable({
  providedIn: 'root',
})
export class ValidateStateService {
  // DISABLED: Repair system is non-functional
  // private store = inject(Store);
  private stateSnapshotService = inject(StateSnapshotService);
  // DISABLED: Repair system is non-functional
  // private repairOperationService = inject(RepairOperationService);
  // private injector = inject(Injector);

  /**
   * Validates current state from NgRx store, repairs if needed, creates a REPAIR operation,
   * and dispatches the repaired state. This is the full Checkpoint D flow.
   *
   * @param context - Logging context (e.g., 'sync', 'conflict-resolution')
   * @param options.callerHoldsLock - If true, skip lock acquisition in repair operation.
   *        Set to true when calling from within a sp_op_log lock (e.g., during sync).
   * @returns true if state is valid (or was successfully repaired), false otherwise
   */
  async validateAndRepairCurrentState(
    context: string,
    _options?: { callerHoldsLock?: boolean },
  ): Promise<boolean> {
    OpLog.normal(
      `[ValidateStateService:${context}] Running post-operation validation...`,
    );

    const currentState = this.stateSnapshotService.getStateSnapshot();

    const result = this.validateAndRepair(
      currentState as unknown as Record<string, unknown>,
    );

    if (result.isValid && !result.wasRepaired) {
      OpLog.normal(`[ValidateStateService:${context}] State valid`);
      return true;
    }

    if (!result.isValid) {
      OpLog.err(
        `[ValidateStateService:${context}] State invalid (repair failed or impossible):`,
        result.error || result.crossModelError,
      );
      return false;
    }

    if (!result.repairedState || !result.repairSummary) {
      OpLog.err(`[ValidateStateService:${context}] Repair failed:`, result.error);
      return false;
    }

    // DISABLED: Repair system is non-functional - this code path is unreachable
    // because validateAndRepair() returns early without setting repairedState
    //
    // const pfapiService = this.injector.get(PfapiService);
    // const clientId = await pfapiService.pf.metaModel.loadClientId();
    // await this.repairOperationService.createRepairOperation(
    //   result.repairedState,
    //   result.repairSummary,
    //   clientId,
    //   { skipLock: options?.callerHoldsLock },
    // );
    // this.store.dispatch(
    //   loadAllData({ appDataComplete: result.repairedState as AppDataComplete }),
    // );
    // OpLog.log(`[ValidateStateService:${context}] Created REPAIR operation`);
    // return true;

    // Should never reach here while repair is disabled
    return false;
  }

  /**
   * Validates application state using both Typia schema validation
   * and cross-model relationship validation via the shared validateFull() function.
   */
  validateState(state: Record<string, unknown>): StateValidationResult {
    // Cast to any since validateFull expects a more specific type
    const fullResult = validateFull(state as any);

    if (fullResult.isValid) {
      OpLog.normal('[ValidateStateService] State validation passed');
      return {
        isValid: true,
        typiaErrors: [],
      };
    }

    const result: StateValidationResult = {
      isValid: false,
      typiaErrors: [],
    };

    if (!fullResult.typiaResult.success) {
      result.typiaErrors = (fullResult.typiaResult as IValidation.IFailure).errors || [];
      OpLog.warn('[ValidateStateService] Typia validation failed', {
        errorCount: result.typiaErrors.length,
      });
    }

    if (fullResult.crossModelError) {
      result.crossModelError = fullResult.crossModelError;
      OpLog.warn('[ValidateStateService] Cross-model validation failed', {
        error: result.crossModelError,
      });
    }

    return result;
  }

  /**
   * Validates state and repairs if necessary.
   * Returns the (possibly repaired) state and repair summary.
   *
   * TEMPORARILY DISABLED: Repair is disabled to help debug archive subtask loss.
   * Instead of repairing, we show an error alert to expose what validation fails.
   */
  validateAndRepair(state: Record<string, unknown>): ValidateAndRepairResult {
    // First, validate the state
    const validationResult = this.validateState(state);

    if (validationResult.isValid) {
      return {
        isValid: true,
        wasRepaired: false,
      };
    }

    // TEMPORARILY DISABLED: Show error instead of repairing
    // This helps debug archive subtask loss by exposing what validation actually fails
    const errorDetails = {
      typiaErrorCount: validationResult.typiaErrors.length,
      typiaErrors: validationResult.typiaErrors.slice(0, 10), // First 10 errors
      crossModelError: validationResult.crossModelError,
    };

    const errorMsg =
      `State validation failed - repair disabled for debugging.\n` +
      `Typia errors: ${validationResult.typiaErrors.length}\n` +
      `Cross-model error: ${validationResult.crossModelError || 'none'}`;

    OpLog.err('[ValidateStateService] ' + errorMsg, errorDetails);

    // Show alert so user knows something is wrong
    alert(`[DEBUG] ${errorMsg}\n\nCheck console for details.`);

    return {
      isValid: false,
      wasRepaired: false,
      error: errorMsg,
      crossModelError: validationResult.crossModelError,
    };

    /* ORIGINAL REPAIR LOGIC - TEMPORARILY DISABLED
    // State is invalid - attempt repair
    OpLog.log('[ValidateStateService] State invalid, attempting repair...');

    // Check if repair is possible
    if (!isDataRepairPossible(state)) {
      OpLog.err('[ValidateStateService] Data repair not possible - state too corrupted');
      return {
        isValid: false,
        wasRepaired: false,
        error: 'Data repair not possible - state too corrupted',
      };
    }

    try {
      // Run repair
      const typiaErrors = validationResult.typiaErrors as IValidation.IError[];
      const repairedState = dataRepair(state, typiaErrors);

      // Create repair summary based on validation errors
      const repairSummary = this._createRepairSummary(
        validationResult,
        state,
        repairedState,
      );

      // Validate the repaired state to confirm it's now valid
      const revalidationResult = this.validateState(repairedState);
      if (!revalidationResult.isValid) {
        OpLog.err('[ValidateStateService] State still invalid after repair');
        return {
          isValid: false,
          wasRepaired: true,
          repairedState,
          repairSummary,
          error: 'State still invalid after repair',
        };
      }

      OpLog.log('[ValidateStateService] State successfully repaired', {
        repairSummary,
      });

      return {
        isValid: true,
        wasRepaired: true,
        repairedState,
        repairSummary,
      };
    } catch (e) {
      OpLog.err('[ValidateStateService] Error during repair', e);
      return {
        isValid: false,
        wasRepaired: false,
        error: `Repair failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    */
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * DISABLED: The following repair helper methods are currently unused.
   * The repair system is disabled for debugging archive subtask loss.
   * Kept for potential future use.
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * private _createRepairSummary(
   *   validationResult: StateValidationResult,
   *   original: AppDataComplete,
   *   repaired: AppDataComplete,
   * ): RepairSummary {
   *   const summary: RepairSummary = {
   *     entityStateFixed: 0,
   *     orphanedEntitiesRestored: 0,
   *     invalidReferencesRemoved: 0,
   *     relationshipsFixed: 0,
   *     structureRepaired: 0,
   *     typeErrorsFixed: 0,
   *   };
   *   summary.typeErrorsFixed = validationResult.typiaErrors.length;
   *   summary.entityStateFixed = this._countEntityStateChanges(original, repaired);
   *   summary.relationshipsFixed = this._countRelationshipChanges(original, repaired);
   *   summary.orphanedEntitiesRestored = this._countOrphanedEntityChanges(original, repaired);
   *   summary.invalidReferencesRemoved = this._countInvalidReferenceRemovals(original, repaired);
   *   summary.structureRepaired = this._countStructureRepairs(original, repaired);
   *   return summary;
   * }
   *
   * private _countEntityStateChanges(original: AppDataComplete, repaired: AppDataComplete): number { ... }
   * private _countRelationshipChanges(original: AppDataComplete, repaired: AppDataComplete): number { ... }
   * private _countOrphanedEntityChanges(original: AppDataComplete, repaired: AppDataComplete): number { ... }
   * private _countInvalidReferenceRemovals(original: AppDataComplete, repaired: AppDataComplete): number { ... }
   * private _countStructureRepairs(original: AppDataComplete, repaired: AppDataComplete): number { ... }
   */
}
