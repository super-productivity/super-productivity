import { inject, Injectable } from '@angular/core';
import { IValidation } from 'typia';
import { Action, Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { validateFull } from './validation-fn';
import { dataRepair } from './data-repair';
import { isDataRepairPossible } from './is-data-repair-possible.util';
import { RepairSummary } from '../core/operation.types';
import { OpLog } from '../../core/log';
import { RepairOperationService } from './repair-operation.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../model/model-config';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { HydrationStateService } from '../apply/hydration-state.service';
import { T } from '../../t.const';
import { alertDialog, confirmDialog } from '../../util/native-dialogs';

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
  private store = inject(Store);
  private stateSnapshotService = inject(StateSnapshotService);
  private repairOperationService = inject(RepairOperationService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private hydrationStateService = inject(HydrationStateService);
  private translateService = inject(TranslateService);

  /**
   * Validates current state from NgRx store, repairs if needed, creates a REPAIR operation,
   * and dispatches the repaired state. This is the full Checkpoint D flow.
   *
   * ## Effect Suppression in Sync Contexts
   * In sync contexts ('sync', 'conflict-resolution', 'partial-apply-failure'), we:
   * 1. Mark the dispatch as remote (isRemote: true) to skip LOCAL_ACTIONS effects
   * 2. Set HydrationStateService flag to suppress selector-based effects
   * 3. Start post-sync cooldown to prevent timing-gap effects
   *
   * ## Implicit Contract for Nested Calls
   * If `isApplyingRemoteOps()` is already true when entering (nested call from sync),
   * this method will NOT:
   * - Call startApplyingRemoteOps() (already set by caller)
   * - Call endApplyingRemoteOps() or startPostSyncCooldown() (caller's responsibility)
   *
   * @param context - Logging context (e.g., 'sync', 'conflict-resolution')
   * @param options.callerHoldsLock - If true, skip lock acquisition in repair operation.
   *        Set to true when calling from within a sp_op_log lock (e.g., during sync).
   * @returns true if state is valid (or was successfully repaired), false otherwise
   */
  async validateAndRepairCurrentState(
    context: string,
    options?: { callerHoldsLock?: boolean },
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

    // Guard: check for clientId
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err('[ValidateStateService] Cannot create repair operation - no clientId');
      return false;
    }

    // Create REPAIR operation first (before dispatching state)
    await this.repairOperationService.createRepairOperation(
      result.repairedState,
      result.repairSummary,
      clientId,
      { skipLock: options?.callerHoldsLock },
    );

    // Determine if we need to suppress effects (sync-related contexts)
    const isSyncContext =
      context === 'sync' ||
      context === 'conflict-resolution' ||
      context === 'partial-apply-failure';

    // Check if already applying to avoid nested call issues
    const wasAlreadyApplying = this.hydrationStateService.isApplyingRemoteOps();
    if (isSyncContext && !wasAlreadyApplying) {
      this.hydrationStateService.startApplyingRemoteOps();
    }

    try {
      // Dispatch loadAllData with isRemote flag in sync contexts to prevent
      // LOCAL_ACTIONS effects from firing (e.g., validateContextAfterDataLoad$)
      const action = loadAllData({
        appDataComplete: result.repairedState as AppDataComplete,
      });
      const actionWithMeta: Action & { meta?: Record<string, unknown> } = isSyncContext
        ? { ...action, meta: { isRemote: true } }
        : action;
      this.store.dispatch(actionWithMeta);

      // Yield to event loop to ensure store update is processed
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      if (isSyncContext && !wasAlreadyApplying) {
        this.hydrationStateService.endApplyingRemoteOps();
        this.hydrationStateService.startPostSyncCooldown();
      }
    }

    OpLog.log(`[ValidateStateService:${context}] Created REPAIR operation`);
    return true;
  }

  /**
   * Validates application state using both Typia schema validation
   * and cross-model relationship validation via the shared validateFull() function.
   *
   * @param state - Application state to validate. Expected to be AppDataComplete
   *                but typed as Record<string, unknown> to allow validation of
   *                potentially corrupted data. If the data doesn't match the
   *                AppDataComplete structure, Typia validation will catch it.
   */
  validateState(state: Record<string, unknown>): StateValidationResult {
    // Cast required because validateFull expects AppDataComplete, but we intentionally
    // accept a looser type to validate potentially corrupted data. If the structure
    // doesn't match, Typia validation will return errors.
    const fullResult = validateFull(state as AppDataComplete);

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
   * Shows a confirmation dialog before executing repair to give users
   * explicit control over when repair runs.
   *
   * ## Note on Blocking confirm()
   * Uses native `confirm()` which blocks the JS thread. This is intentional:
   * - Prevents race conditions during repair
   * - Ensures user explicitly acknowledges before data modification
   * However, this could cause issues if called during background sync with
   * user not actively looking at the app. Consider deferring repair to app
   * foreground if this becomes problematic.
   *
   * ## TOCTOU Limitation
   * The state snapshot passed to this method is validated, then user confirms,
   * then repair runs on that same snapshot. If the actual NgRx state changed
   * during the confirm dialog (via another tab, service worker, or user action),
   * we'll repair and dispatch the older snapshot, potentially overwriting recent
   * changes. This is an accepted tradeoff to keep the API simple. The repair
   * operation will still be valid and the REPAIR op in the log reflects what
   * was applied.
   *
   * ## Repair Summary Limitations
   * The `_createRepairSummary()` method currently only counts typia errors.
   * More sophisticated diff-based counting could be added later to track
   * specific repair actions (orphaned entities, invalid references, etc).
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

    // State is invalid - ask user for confirmation before repair
    OpLog.log('[ValidateStateService] State invalid, asking user for confirmation...');

    // Check if repair is possible
    if (!isDataRepairPossible(state as AppDataComplete)) {
      OpLog.err('[ValidateStateService] Data repair not possible - state too corrupted');
      return {
        isValid: false,
        wasRepaired: false,
        error:
          'Data repair not possible - state too corrupted. Please restore from a backup.',
      };
    }

    // Show confirmation dialog using translated message
    const confirmTitle = this.translateService.instant(
      T.F.SYNC.D_DATA_REPAIR_CONFIRM.TITLE,
    );
    const confirmMsg = this.translateService.instant(T.F.SYNC.D_DATA_REPAIR_CONFIRM.MSG);
    const userConfirmed = confirmDialog(`${confirmTitle}\n\n${confirmMsg}`);

    if (!userConfirmed) {
      OpLog.warn('[ValidateStateService] User declined repair');
      return {
        isValid: false,
        wasRepaired: false,
        error: 'User declined repair',
      };
    }

    // User confirmed - proceed with repair
    try {
      const typiaErrors = validationResult.typiaErrors as IValidation.IError[];
      const repairedState = dataRepair(state as AppDataComplete, typiaErrors);

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
        // Notify user that repair failed - they confirmed but it didn't work
        alertDialog(
          'Repair attempted but failed to fully fix data issues. ' +
            'Please try restoring from a backup or contact support.',
        );
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
  }

  /**
   * Creates a repair summary with counts of what was fixed.
   * Simple stub that primarily counts typia errors - more sophisticated
   * counting can be added later if needed.
   */
  private _createRepairSummary(
    validationResult: StateValidationResult,
    _original: Record<string, unknown>,
    _repaired: Record<string, unknown>,
  ): RepairSummary {
    return {
      entityStateFixed: 0,
      orphanedEntitiesRestored: 0,
      invalidReferencesRemoved: 0,
      relationshipsFixed: 0,
      structureRepaired: 0,
      typeErrorsFixed: validationResult.typiaErrors.length,
    };
  }
}
