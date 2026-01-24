import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { Action } from '@ngrx/store';
import { addNewTagsFromShortSyntax } from './task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  catchError,
  concatMap,
  filter,
  map,
  mapTo,
  mergeMap,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { GlobalConfigService } from '../../config/global-config.service';
import { unique } from '../../../util/unique';
import { TaskService } from '../task.service';
import { EMPTY, of } from 'rxjs';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { shortSyntax } from '../short-syntax';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { environment } from '../../../../environments/environment';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { MatDialog } from '@angular/material/dialog';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { WorkContextService } from '../../work-context/work-context.service';

import { INBOX_PROJECT } from '../../project/project.const';
import { devError } from '../../../util/dev-error';
import { TaskLog } from '../../../core/log';

@Injectable()
export class ShortSyntaxEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _taskService = inject(TaskService);
  private _tagService = inject(TagService);
  private _projectService = inject(ProjectService);
  private _globalConfigService = inject(GlobalConfigService);
  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);
  private _layoutService = inject(LayoutService);
  private _workContextService = inject(WorkContextService);

  shortSyntax$ = createEffect(() =>
    this._actions$.pipe(
      ofType(TaskSharedActions.addTask, TaskSharedActions.updateTask),
      filter((action): boolean => {
        if (action.isIgnoreShortSyntax) {
          return false;
        }
        if (action.type !== TaskSharedActions.updateTask.type) {
          return true;
        }
        const changeProps = Object.keys(action.task.changes);
        // we only want to execute this for task title updates
        return changeProps.length === 1 && changeProps[0] === 'title';
      }),
      // dirty fix to execute this after setDefaultProjectId$ effect
      concatMap((originalAction) => {
        return this._taskService.getByIdOnce$(originalAction.task.id as string).pipe(
          map((task) => ({
            task,
            originalAction,
          })),
        );
      }),
      withLatestFrom(
        this._tagService.tagsNoMyDayAndNoList$,
        this._projectService.list$,
        this._globalConfigService.tasks$.pipe(
          map((tasks) => tasks.defaultProjectId),

          concatMap((defaultProjectId) => {
            if (this._workContextService.activeWorkContextId === INBOX_PROJECT.id) {
              // if we are in the INBOX project, we do not need to fetch the default project, since it is not used in this context
              return of(null);
            }

            return defaultProjectId
              ? this._projectService.getByIdOnce$(defaultProjectId).pipe(
                  tap((project) => {
                    if (!project) {
                      // to avoid further data inconsistencies
                      throw new Error('Default Project not found');
                    }
                  }),
                  mapTo(defaultProjectId),
                  catchError(() => {
                    devError('Default Project not found, using null instead');
                    return of(null);
                  }),
                )
              : of(null);
          }),
        ),
      ),
      mergeMap(([{ task, originalAction }, tags, projects, defaultProjectId]) => {
        const isReplaceTagIds = originalAction.type === TaskSharedActions.updateTask.type;
        const r = shortSyntax(
          task,
          this._globalConfigService?.cfg()?.shortSyntax ||
            DEFAULT_GLOBAL_CONFIG.shortSyntax,
          tags,
          projects,
          undefined,
          isReplaceTagIds ? 'replace' : 'combine',
        );
        if (environment.production) {
          TaskLog.log('shortSyntax', r);
        }
        const isAddDefaultProjectIfNecessary: boolean =
          !!defaultProjectId &&
          !task.projectId &&
          !task.parentId &&
          task.projectId !== defaultProjectId &&
          originalAction.type === TaskSharedActions.addTask.type;

        if (!r) {
          if (isAddDefaultProjectIfNecessary) {
            return [
              TaskSharedActions.moveToOtherProject({
                task: { ...task, subTasks: [] },
                targetProjectId: defaultProjectId as string,
              }),
            ];
          }
          return EMPTY;
        }

        const actions: Action[] = [];
        const { taskChanges } = r;

        // Build scheduling info from parsed short syntax
        let schedulingInfo:
          | {
              day?: string;
              isAddToTop?: boolean;
              dueWithTime?: number;
              remindAt?: number | null;
              isMoveToBacklog?: boolean;
            }
          | undefined;

        if (taskChanges.dueWithTime && !taskChanges.remindAt) {
          const { dueWithTime } = taskChanges;
          if (taskChanges.hasPlannedTime === false) {
            // Plan for day only (no specific time)
            const plannedDay = new Date(dueWithTime);
            schedulingInfo = {
              day: getDbDateStr(plannedDay),
              isAddToTop: false,
            };
          } else {
            // Schedule with specific time
            schedulingInfo = {
              dueWithTime,
              remindAt: remindOptionToMilliseconds(
                dueWithTime,
                this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
                  DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
              ),
              isMoveToBacklog: false,
            };
          }
        }

        // Determine target project
        let targetProjectId: string | undefined;
        if (r.projectId && r.projectId !== task.projectId && !task.parentId) {
          if (task.repeatCfgId) {
            this._snackService.open({
              ico: 'warning',
              msg: T.F.TASK.S.CANNOT_ASSIGN_PROJECT_FOR_REPEATABLE_TASK,
            });
          } else {
            targetProjectId = r.projectId;
          }
        } else if (isAddDefaultProjectIfNecessary) {
          targetProjectId = defaultProjectId as string;
        }

        // Build task changes including tagIds update
        const tagIds: string[] = [...(r.taskChanges.tagIds || task.tagIds)];
        const isEqualTags = JSON.stringify(tagIds) === JSON.stringify(task.tagIds);
        const finalTaskChanges = { ...taskChanges };
        if (tagIds && tagIds.length && !isEqualTags) {
          finalTaskChanges.tagIds = unique(tagIds);
        }

        // Use compound action for atomic state update
        actions.push(
          TaskSharedActions.applyShortSyntax({
            task,
            taskChanges: finalTaskChanges,
            targetProjectId,
            schedulingInfo,
          }),
        );

        // New tag creation requires user confirmation, so remains separate
        if (r.newTagTitles.length) {
          actions.push(
            addNewTagsFromShortSyntax({ taskId: task.id, newTitles: r.newTagTitles }),
          );
        }

        return actions;
      }),
    ),
  );

  shortSyntaxAddNewTags$ = createEffect(() =>
    this._actions$.pipe(
      ofType(addNewTagsFromShortSyntax),
      // needed cause otherwise task gets the focus after blur & hide
      tap((v) => this._layoutService.hideAddTaskBar()),
      concatMap(({ taskId, newTitles }) => {
        //Making sure the user isnt trying to create two tags with the same name
        const uniqueNewTitles = [...new Set(newTitles)];

        return this._matDialog
          .open(DialogConfirmComponent, {
            restoreFocus: true,
            autoFocus: true,
            data: {
              okTxt:
                uniqueNewTitles.length > 1
                  ? T.F.TASK.D_CONFIRM_SHORT_SYNTAX_NEW_TAGS.OK
                  : T.F.TASK.D_CONFIRM_SHORT_SYNTAX_NEW_TAG.OK,
              message:
                uniqueNewTitles.length > 1
                  ? T.F.TASK.D_CONFIRM_SHORT_SYNTAX_NEW_TAGS.MSG
                  : T.F.TASK.D_CONFIRM_SHORT_SYNTAX_NEW_TAG.MSG,
              translateParams: {
                tagsTxt: `<strong>${uniqueNewTitles.join(', ')}</strong>`,
              },
            },
          })
          .afterClosed()
          .pipe(
            // NOTE: it is important to get a fresh task here, since otherwise we might run into #3728
            withLatestFrom(this._taskService.getByIdOnce$(taskId)),
            mergeMap(([isConfirm, task]) => {
              const actions: Action[] = [];
              if (isConfirm) {
                const newTagIds = [...task.tagIds];
                uniqueNewTitles.forEach((newTagTitle) => {
                  const { action, id } = this._tagService.getAddTagActionAndId({
                    title: newTagTitle,
                  });
                  actions.push(action);
                  newTagIds.push(id);
                });
                actions.push(
                  TaskSharedActions.updateTask({
                    task: {
                      id: task.id,
                      changes: {
                        tagIds: unique(newTagIds),
                      },
                    },
                  }),
                );
              }
              return of(...actions);
            }),
          );
      }),
    ),
  );
}
