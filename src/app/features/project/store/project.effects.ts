import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { filter, map, tap } from 'rxjs/operators';
import {
  addProject,
  moveAllProjectBacklogTasksToRegularList,
  updateProject,
} from './project.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { T } from '../../../t.const';
import { Project } from '../project.model';
import { Observable } from 'rxjs';

@Injectable()
export class ProjectEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _snackService = inject(SnackService);
  private _globalConfigService = inject(GlobalConfigService);

  /**
   * Handles non-archive cleanup when a project is deleted.
   *
   * NOTE: Archive cleanup (task removal, time tracking cleanup) is now handled by
   * ArchiveOperationHandler, which is the single source of truth for archive operations.
   *
   * @see ArchiveOperationHandler._handleDeleteProject
   */
  deleteProjectRelatedData: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteProject),
        tap(({ projectId }) => {
          // Clear defaultProjectId if the deleted project was the default
          const cfg = this._globalConfigService.cfg();
          if (cfg && projectId === cfg.misc.defaultProjectId) {
            this._globalConfigService.updateSection('misc', { defaultProjectId: null });
          }
        }),
      ),
    { dispatch: false },
  );

  moveAllProjectToTodayListWhenBacklogIsDisabled$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateProject),
        filter((a) => a.project.changes.isEnableBacklog === false),
        map((a) => {
          return moveAllProjectBacklogTasksToRegularList({
            projectId: a.project.id as string,
          });
        }),
      ),
  );

  // CURRENTLY NOT IMPLEMENTED
  // archiveProject: Observable<unknown> = createEffect(
  //   () =>
  //     this._actions$.pipe(
  //       ofType(archiveProject.type),
  //       tap(async ({ id }) => {
  //         await this._pfapiService.archiveProject(id);
  //         // TODO remove reminders
  //         this._snackService.open({
  //           ico: 'archive',
  //           msg: T.F.PROJECT.S.ARCHIVED,
  //         });
  //       }),
  //     ),
  //   { dispatch: false },
  // );
  // unarchiveProject: Observable<unknown> = createEffect(
  //   () =>
  //     this._actions$.pipe(
  //       ofType(unarchiveProject.type),
  //       tap(async ({ id }) => {
  //         await this._pfapiService.unarchiveProject(id);
  //
  //         this._snackService.open({
  //           ico: 'unarchive',
  //           msg: T.F.PROJECT.S.UNARCHIVED,
  //         });
  //       }),
  //     ),
  //   { dispatch: false },
  // );

  // PURE SNACKS
  // -----------

  snackUpdateBaseSettings$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateProject.type),
        tap(() => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.PROJECT.S.UPDATED,
          });
        }),
      ),
    { dispatch: false },
  );

  onProjectCreatedSnack: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(addProject.type),
        tap(({ project }) => {
          this._snackService.open({
            ico: 'add',
            type: 'SUCCESS',
            msg: T.F.PROJECT.S.CREATED,
            translateParams: { title: (project as Project).title },
          });
        }),
      ),
    { dispatch: false },
  );

  showDeletionSnack: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteProject.type),
        tap(() => {
          this._snackService.open({
            ico: 'delete_forever',
            msg: T.F.PROJECT.S.DELETED,
          });
        }),
      ),
    { dispatch: false },
  );
}
