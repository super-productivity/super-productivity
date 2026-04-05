import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Update } from '@ngrx/entity';
import { MatDialog } from '@angular/material/dialog';
import { Task, TaskWithSubTasks } from './task.model';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { ProjectService } from '../project/project.service';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../t.const';
import { _MISSING_PROJECT_ } from '../project/project.const';
import { TaskService } from './task.service';

@Injectable({
  providedIn: 'root',
})
export class TaskBatchOperationService {
  private readonly _taskService = inject(TaskService);
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _projectService = inject(ProjectService);
  private readonly _matDialog = inject(MatDialog);

  async moveToProject(task: TaskWithSubTasks, projectId: string): Promise<boolean> {
    if (projectId === task.projectId) {
      return false;
    }

    if (!task.repeatCfgId) {
      this._taskService.moveToProject(task, projectId);
      return true;
    }

    const [repeatCfg, nonArchiveInstancesWithSubTasks, archiveInstances, targetProject] =
      await Promise.all([
        firstValueFrom(
          this._taskRepeatCfgService.getTaskRepeatCfgById$(task.repeatCfgId),
        ),
        firstValueFrom(
          this._taskService.getTasksWithSubTasksByRepeatCfgId$(task.repeatCfgId),
        ),
        this._taskService.getArchiveTasksForRepeatCfgId(task.repeatCfgId),
        firstValueFrom(this._projectService.getByIdOnce$(projectId)),
      ]);

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
    nonArchiveInstancesWithSubTasks.forEach((nonArchiveTask) => {
      this._taskService.moveToProject(nonArchiveTask, projectId);
    });

    const archiveUpdates: Update<Task>[] = [];
    archiveInstances.forEach((archiveTask) => {
      archiveUpdates.push({
        id: archiveTask.id,
        changes: { projectId },
      });
      if (archiveTask.subTaskIds.length) {
        archiveTask.subTaskIds.forEach((subId) => {
          archiveUpdates.push({
            id: subId,
            changes: { projectId },
          });
        });
      }
    });
    await this._taskService.updateArchiveTasks(archiveUpdates);
    return true;
  }
}
