import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, forkJoin } from 'rxjs';
import { first } from 'rxjs/operators';
import { Update } from '@ngrx/entity';
import { TaskService } from './task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { ProjectService } from '../project/project.service';
import { TaskCopy, TaskWithSubTasks } from './task.model';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../t.const';
import { _MISSING_PROJECT_ } from '../project/project.const';
import { TaskLog } from '../../core/log';

/**
 * Moves a top-level task to another project, including the recurring-task
 * case: the repeat config plus every existing instance (also archived ones)
 * move together after one confirmation. Shared by the task row, the context
 * menu and the bulk action service so the branching lives in one place.
 */
@Injectable({
  providedIn: 'root',
})
export class TaskMoveToProjectService {
  private readonly _taskService = inject(TaskService);
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _projectService = inject(ProjectService);
  private readonly _matDialog = inject(MatDialog);

  /**
   * @returns true when the task was moved, false when nothing changed (same
   *   project, or the user cancelled the recurring-task confirmation).
   */
  async moveToProject(task: TaskWithSubTasks, projectId: string): Promise<boolean> {
    if (projectId === task.projectId || task.parentId) {
      return false;
    }
    if (!task.repeatCfgId) {
      this._taskService.moveToProject(task, projectId);
      return true;
    }

    const [repeatCfg, nonArchiveInstancesWithSubTasks, archiveInstances, targetProject] =
      await firstValueFrom(
        forkJoin([
          this._taskRepeatCfgService
            .getTaskRepeatCfgByIdAllowUndefined$(task.repeatCfgId)
            .pipe(first()),
          this._taskService
            .getTasksWithSubTasksByRepeatCfgId$(task.repeatCfgId)
            .pipe(first()),
          this._taskService.getArchiveTasksForRepeatCfgId(task.repeatCfgId),
          this._projectService.getByIdOnce$(projectId),
        ]),
      );
    TaskLog.log({
      repeatCfgId: repeatCfg?.id,
      nonArchiveInstances: nonArchiveInstancesWithSubTasks.length,
      archiveInstances: archiveInstances.length,
    });

    // Repeat config was deleted (e.g. via cross-client sync) but the task
    // still references it — treat it as a plain task move instead of
    // crashing on the missing config. (#8715)
    if (!repeatCfg) {
      this._taskService.moveToProject(task, projectId);
      return true;
    }

    // Only a single instance (probably just created): update the config directly.
    if (nonArchiveInstancesWithSubTasks.length === 1 && archiveInstances.length === 0) {
      this._taskRepeatCfgService.updateTaskRepeatCfg(repeatCfg.id, { projectId });
      this._taskService.moveToProject(task, projectId);
      return true;
    }

    const isConfirm = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK_REPEAT.D_CONFIRM_MOVE_TO_PROJECT.OK,
            message: T.F.TASK_REPEAT.D_CONFIRM_MOVE_TO_PROJECT.MSG,
            translateParams: {
              projectName: targetProject?.title ?? _MISSING_PROJECT_,
              tasksNr: nonArchiveInstancesWithSubTasks.length + archiveInstances.length,
            },
          },
        })
        .afterClosed(),
    );
    if (!isConfirm) {
      return false;
    }

    this._taskRepeatCfgService.updateTaskRepeatCfg(repeatCfg.id, { projectId });
    nonArchiveInstancesWithSubTasks.forEach((instance) => {
      this._taskService.moveToProject(instance, projectId);
    });
    const archiveUpdates: Update<TaskCopy>[] = [];
    archiveInstances.forEach((archiveTask) => {
      archiveUpdates.push({ id: archiveTask.id, changes: { projectId } });
      archiveTask.subTaskIds.forEach((subId) => {
        archiveUpdates.push({ id: subId, changes: { projectId } });
      });
    });
    if (archiveUpdates.length) {
      await this._taskService.updateArchiveTasks(archiveUpdates);
    }
    return true;
  }
}
