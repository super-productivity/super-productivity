import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { Store } from '@ngrx/store';
import {
  selectTodayTagRepair,
  selectTodayTaskIds,
} from '../../work-context/store/work-context.selectors';
import { T } from '../../../t.const';
import { SnackService } from '../../../core/snack/snack.service';
import { deleteTag, deleteTags, updateTag } from './tag.actions';
import { TagService } from '../tag.service';
import { EMPTY, Observable, of } from 'rxjs';
import { WorkContextType } from '../../work-context/work-context.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { Router } from '@angular/router';
import { TODAY_TAG } from '../tag.const';
import { fastArrayCompare } from '../../../util/fast-array-compare';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TranslateService } from '@ngx-translate/core';
import { PlannerService } from '../../planner/planner.service';
import { selectAllTasksDueToday } from '../../planner/store/planner.selectors';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Log } from '../../../core/log';
import { skipDuringSyncWindow } from '../../../util/skip-during-sync-window.operator';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
import { alertDialog, confirmDialog } from '../../../util/native-dialogs';

@Injectable()
export class TagEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject(Store);
  private _snackService = inject(SnackService);
  private _tagService = inject(TagService);
  private _workContextService = inject(WorkContextService);
  private _router = inject(Router);
  private _translateService = inject(TranslateService);
  private _plannerService = inject(PlannerService);

  snackUpdateBaseSettings$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateTag),
        tap(
          (action) =>
            !action.isSkipSnack &&
            this._snackService.open({
              type: 'SUCCESS',
              msg: T.F.TAG.S.UPDATED,
            }),
        ),
      ),
    { dispatch: false },
  );

  snackPlanForToday$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.planTasksForToday),
        filter(({ isShowSnack }) => !!isShowSnack),
        tap(async ({ taskIds }) => {
          // if (taskIds.length === 1) {
          //   const task = await this._taskService.getByIdOnce$(taskIds[0]).toPromise();
          // }
          const formattedDate = this._translateService.instant(T.G.TODAY_TAG_TITLE);
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.PLANNER.S.TASK_PLANNED_FOR,
            ico: 'today',
            translateParams: {
              date: formattedDate,
              extra: await this._plannerService.getSnackExtraStr(getDbDateStr()),
            },
          });
        }),
      ),
    { dispatch: false },
  );

  /**
   * Redirects to Today tag if the current tag is deleted.
   *
   * NOTE: Archive cleanup (removing tags from archived tasks, cleaning up time tracking)
   * is now handled by ArchiveOperationHandler, which is the single source of truth for
   * archive operations.
   *
   * @see ArchiveOperationHandler._handleDeleteTags
   */
  redirectIfCurrentTagIsDeleted: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(deleteTag, deleteTags),
        map((a) => ('ids' in a ? a.ids : [a.id])),
        tap(async (tagIdsToRemove: string[]) => {
          if (
            tagIdsToRemove.includes(
              this._workContextService.activeWorkContextId as string,
            )
          ) {
            this._router.navigate([`tag/${TODAY_TAG.id}/tasks`]);
          }
        }),
      ),
    { dispatch: false },
  );

  /**
   * SAFETY: Guarded with skipWhileApplyingRemoteOps() because this effect
   * dispatches via tagService.updateTag() inside tap(), bypassing dispatch:false.
   * Without the guard, intermediate sync states could trigger false null-task detection.
   */
  cleanupNullTasksForTaskList$: Observable<unknown> = createEffect(
    () =>
      this._workContextService.activeWorkContextTypeAndId$.pipe(
        skipWhileApplyingRemoteOps(),
        filter(({ activeType }) => activeType === WorkContextType.TAG),
        switchMap(({ activeType, activeId }) =>
          this._workContextService.mainListTasks$.pipe(
            take(1),
            map((tasks) => ({
              allTasks: tasks,
              nullTasks: tasks.filter((task) => !task),
              activeType,
              activeId,
            })),
          ),
        ),
        filter(({ nullTasks }) => nullTasks.length > 0),
        tap((arg) => Log.log('Error INFO Today:', arg)),
        tap(({ activeId, allTasks }) => {
          const allIds = allTasks.map((t) => t && t.id);
          const r = confirmDialog(
            'Nooo! We found some tasks with no data. It is strongly recommended to delete them to avoid further data corruption. Delete them now?',
          );
          if (r) {
            this._tagService.updateTag(activeId, {
              taskIds: allIds.filter((id) => !!id),
            });
            alertDialog('Done!');
          }
        }),
      ),
    { dispatch: false },
  );

  /**
   * Maintains TODAY_TAG.taskIds consistency by:
   * 1. Removing subtasks whose parents are also in the list (parent takes precedence)
   * 2. Adding tasks with dueDay=today that aren't in the list yet
   *
   * SAFETY: This is a selector-based effect that dispatches actions.
   * Protected against sync replay by:
   * - skipDuringSyncWindow() - skips during both op application AND post-sync cooldown
   * - distinctUntilChanged - prevents duplicate dispatches for same state
   * - explicit isChanged check before dispatch
   *
   * Note: Converting to a meta-reducer was considered but rejected because:
   * - The logic needs access to multiple selectors (todayTaskIds, allTasksDueToday)
   * - The current guards provide sufficient protection
   * - This is a "cleanup" effect that corrects inconsistencies, not a primary data flow
   */
  preventParentAndSubTaskInTodayList$ = createEffect(() =>
    this._store$.select(selectTodayTaskIds).pipe(
      filter((v) => v.length > 0),
      skipDuringSyncWindow(),
      distinctUntilChanged(fastArrayCompare),
      // NOTE: wait a bit for potential effects to be executed
      switchMap((todayTaskIds) =>
        this._store$.select(selectAllTasksDueToday).pipe(
          first(),
          map((allTasksDueToday) => ({ allTasksDueToday, todayTaskIds })),
        ),
      ),
      switchMap(({ allTasksDueToday, todayTaskIds }) => {
        const tasksWithParentInListIds = allTasksDueToday
          .filter((t) => t.parentId && todayTaskIds.includes(t.parentId))
          .map((t) => t.id);

        const dueNotInListIds = allTasksDueToday
          .filter((t) => !todayTaskIds.includes(t.id))
          .map((t) => t.id);

        const newTaskIds = [...todayTaskIds, ...dueNotInListIds].filter(
          (id) => !tasksWithParentInListIds.includes(id),
        );

        // Only dispatch if the taskIds actually change
        const isChanged =
          newTaskIds.length !== todayTaskIds.length ||
          newTaskIds.some((id, i) => id !== todayTaskIds[i]);

        if (isChanged && (tasksWithParentInListIds.length || dueNotInListIds.length)) {
          Log.log('Preventing parent and subtask in today list', {
            isChanged,
            tasksWithParentInListIds,
            dueNotInListIds,
            todayTaskIds,
            newTaskIds,
          });

          return of(
            updateTag({
              tag: {
                id: TODAY_TAG.id,
                changes: {
                  taskIds: newTaskIds,
                },
              },
              isSkipSnack: true,
            }),
          );
        }

        return EMPTY;
      }),
    ),
  );

  /**
   * Repairs TODAY_TAG.taskIds when it becomes inconsistent with tasks' dueDay values.
   *
   * This handles state divergence caused by per-entity conflict resolution during sync.
   * When "Add to today" and "Snooze" operations conflict, the TASK entity may resolve
   * to one client's values while TODAY_TAG entity gets different values.
   *
   * SAFETY: Protected by skipDuringSyncWindow() - won't fire during sync replay
   * or post-sync cooldown period.
   *
   * @see selectTodayTagRepair - detects inconsistencies between TODAY_TAG.taskIds and task.dueDay
   * @see docs/ai/today-tag-architecture.md
   */
  repairTodayTagConsistency$: Observable<unknown> = createEffect(() =>
    this._store$.select(selectTodayTagRepair).pipe(
      skipDuringSyncWindow(),
      filter(
        (repair): repair is { needsRepair: boolean; repairedTaskIds: string[] } =>
          repair !== null && repair.needsRepair,
      ),
      tap((repair) => {
        Log.log('Repairing TODAY_TAG consistency', {
          repairedTaskIds: repair.repairedTaskIds,
        });
      }),
      map((repair) =>
        updateTag({
          tag: {
            id: TODAY_TAG.id,
            changes: {
              taskIds: repair.repairedTaskIds,
            },
          },
          isSkipSnack: true,
        }),
      ),
    ),
  );
  // PREVENT LAST TAG DELETION ACTIONS
  // ---------------------------------------------
}
