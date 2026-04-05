import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Update } from '@ngrx/entity';
import { Store } from '@ngrx/store';
import { TaskSelectionService } from '../task-selection.service';
import { TaskService } from '../task.service';
import { ProjectService } from '../../project/project.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../../t.const';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { TaskBatchOperationService } from '../task-batch-operation.service';
import { Task, TaskWithSubTasks } from '../task.model';
import { DialogSelectProjectComponent } from '../dialog-select-project/dialog-select-project.component';
import { Project } from '../../project/project.model';

@Component({
  selector: 'task-selection-toolbar',
  templateUrl: './task-selection-toolbar.component.html',
  styleUrl: './task-selection-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MatIconButton, TranslateModule],
})
export class TaskSelectionToolbarComponent {
  private readonly _selectionService = inject(TaskSelectionService);
  private readonly _taskService = inject(TaskService);
  private readonly _projectService = inject(ProjectService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _store = inject(Store);
  private readonly _taskBatchOperationService = inject(TaskBatchOperationService);

  protected readonly selectedCount = this._selectionService.selectedCount;
  protected readonly T = T;

  private readonly _selectedTasks = computed(() => {
    const ids = this._selectionService.selectedIds();
    const entities = this._taskService.taskEntities();
    return ids
      .map((id) => entities[id])
      .filter((task): task is TaskWithSubTasks => !!task) as TaskWithSubTasks[];
  });

  private readonly _availableTargetProjects = computed<Project[]>(() => {
    const selectedTasks = this._selectedTasks().filter((task) => !task.parentId);
    const projects = this._projectService.listSortedForUI();
    if (!selectedTasks.length) {
      return [];
    }

    const firstProjectId = selectedTasks[0].projectId;
    const allTasksInSameProject =
      !!firstProjectId &&
      selectedTasks.every((task) => task.projectId === firstProjectId);

    return allTasksInSameProject
      ? projects.filter((project) => project.id !== firstProjectId)
      : projects;
  });

  protected readonly hasProjectTargets = computed(
    () => this._availableTargetProjects().length > 0,
  );

  async deleteSelected(): Promise<void> {
    const selectedIds = this._selectionService.selectedIds();
    if (!selectedIds.length) {
      return;
    }

    const isConfirm = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.TASK_SELECTION.D_CONFIRM_DELETE.MSG,
            translateParams: { count: selectedIds.length },
          },
        })
        .afterClosed(),
    );
    if (!isConfirm) {
      return;
    }

    this._taskService.removeMultipleTasks(selectedIds);
    this._selectionService.clearSelection();
  }

  markAsDone(): void {
    const updates: Update<Task>[] = this._selectedTasks()
      .filter((task) => !task.isDone)
      .map((task) => ({ id: task.id, changes: { isDone: true } }));

    if (!updates.length) {
      return;
    }

    this._store.dispatch(TaskSharedActions.updateTasks({ tasks: updates }));
    this._selectionService.clearSelection();
  }

  async moveToProject(): Promise<void> {
    const selectedTasks = this._selectedTasks().filter((task) => !task.parentId);
    if (!selectedTasks.length) {
      return;
    }

    const projects = this._availableTargetProjects();
    if (!projects.length) {
      return;
    }

    const pickedProjectId = await firstValueFrom(
      this._matDialog
        .open(DialogSelectProjectComponent, { data: { projects } })
        .afterClosed(),
    );
    if (!pickedProjectId) {
      return;
    }

    const uniqueTasksById = Array.from(
      new Map(selectedTasks.map((task) => [task.id, task])).values(),
    );
    const recurringTasks: TaskWithSubTasks[] = [];
    const nonRecurringTasks: TaskWithSubTasks[] = [];
    const seenRepeatCfgIds = new Set<string>();

    for (const task of uniqueTasksById) {
      if (task.repeatCfgId) {
        if (seenRepeatCfgIds.has(task.repeatCfgId)) {
          continue;
        }
        seenRepeatCfgIds.add(task.repeatCfgId);
        recurringTasks.push(task);
      } else {
        nonRecurringTasks.push(task);
      }
    }

    await Promise.all(
      nonRecurringTasks.map((task) =>
        this._taskBatchOperationService.moveToProject(task, pickedProjectId),
      ),
    );

    for (const task of recurringTasks) {
      await this._taskBatchOperationService.moveToProject(task, pickedProjectId);
    }
    this._selectionService.clearSelection();
  }

  clearSelection(): void {
    this._selectionService.clearSelection();
  }
}
