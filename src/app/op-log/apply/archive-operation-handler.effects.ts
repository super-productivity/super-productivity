import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { concatMap, filter, tap } from 'rxjs/operators';
import {
  ArchiveOperationHandler,
  isArchiveAffectingAction,
} from './archive-operation-handler.service';
import { devError } from '../../util/dev-error';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { remoteArchiveDataApplied } from '../../features/archive/store/archive.actions';
import { WorklogService } from '../../features/worklog/worklog.service';

/**
 * Unified effect for all archive-affecting operations.
 *
 * This effect routes all local archive-affecting actions through ArchiveOperationHandler,
 * making it the SINGLE SOURCE OF TRUTH for archive storage operations.
 *
 * ## How It Works
 *
 * - Uses LOCAL_ACTIONS to only process local user actions (not remote sync operations)
 * - Filters actions using isArchiveAffectingAction() helper
 * - Delegates all archive logic to ArchiveOperationHandler.handleOperation()
 *
 * ## Why LOCAL_ACTIONS (Not Actions)
 *
 * Archive operations need different handling for local vs remote actions:
 *
 * - LOCAL actions: This effect calls ArchiveOperationHandler.handleOperation()
 * - REMOTE actions: OperationApplierService calls ArchiveOperationHandler.handleOperation() directly
 *
 * If we used `Actions` (all actions), remote operations would be processed TWICE:
 * 1. Explicitly by OperationApplierService (correct)
 * 2. By this effect (duplicate!)
 *
 * Using LOCAL_ACTIONS ensures exactly one code path handles each archive operation.
 *
 * ## Operation Flow
 *
 * ```
 * LOCAL OPERATIONS:
 * User action -> Reducers -> This effect -> ArchiveOperationHandler.handleOperation()
 *
 * REMOTE OPERATIONS:
 * OperationApplierService -> dispatch() -> Reducers
 *                         \-> ArchiveOperationHandler.handleOperation() (explicit call)
 *                             (this effect is skipped via LOCAL_ACTIONS filter)
 * ```
 *
 * ## Historical Context
 *
 * Previously, archive operations were scattered across multiple effect files:
 * - archive.effects.ts - flushYoungToOld, restoreTask
 * - project.effects.ts - deleteProject archive cleanup
 * - tag.effects.ts - deleteTag/deleteTags archive cleanup
 * - task-repeat-cfg.effects.ts - deleteTaskRepeatCfg archive cleanup
 * - unlink-all-tasks-on-provider-deletion.effects.ts - deleteIssueProvider cleanup
 *
 * This unified effect consolidates all archive handling to eliminate duplicate code
 * between local effects and remote operation handling.
 *
 * @see ArchiveOperationHandler for list of supported archive-affecting actions
 * @see isArchiveAffectingAction for the action filtering logic
 * @see OperationApplierService for how remote operations call the handler directly
 */
@Injectable()
export class ArchiveOperationHandlerEffects {
  private _localActions$ = inject(LOCAL_ACTIONS);
  private _allActions$ = inject(Actions);
  private _archiveOperationHandler = inject(ArchiveOperationHandler);
  private _snackService = inject(SnackService);
  private _worklogService = inject(WorklogService);

  /**
   * Processes all archive-affecting local actions through the central handler.
   *
   * Uses concatMap to ensure operations are processed sequentially, which is
   * important for archive consistency (e.g., deleteProject shouldn't overlap
   * with other archive writes).
   */
  handleArchiveOperations$ = createEffect(
    () =>
      this._localActions$.pipe(
        filter(isArchiveAffectingAction),
        concatMap(async (action) => {
          try {
            await this._archiveOperationHandler.handleOperation(action);
          } catch (e) {
            // Archive operations failing is serious but not critical to app function.
            // Log the error and notify user but don't crash the effect stream.
            devError(e);
            this._snackService.open({
              type: 'ERROR',
              msg: T.F.SYNC.S.ARCHIVE_OPERATION_FAILED,
            });
          }
        }),
      ),
    { dispatch: false },
  );

  /**
   * Refreshes the worklog UI when remote archive-affecting operations are applied.
   *
   * This effect breaks the circular dependency between OperationApplierService
   * and WorklogService by using NgRx actions instead of direct service injection.
   *
   * Note: Uses Actions (not LOCAL_ACTIONS) because remoteArchiveDataApplied is
   * a non-persistent action that is only dispatched after applying remote operations.
   */
  refreshWorklogAfterRemoteArchiveOps$ = createEffect(
    () =>
      this._allActions$.pipe(
        ofType(remoteArchiveDataApplied),
        tap(() => this._worklogService.refreshWorklog()),
      ),
    { dispatch: false },
  );
}
