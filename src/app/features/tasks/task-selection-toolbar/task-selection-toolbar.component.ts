import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { TaskSelectionService } from '../task-selection.service';
import { TaskService } from '../task.service';
import { ProjectService } from '../../project/project.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../../t.const';
import { TaskBatchOperationService } from '../task-batch-operation.service';
import { TaskWithSubTasks } from '../task.model';
import { DialogSelectProjectComponent } from '../dialog-select-project/dialog-select-project.component';
import { Project } from '../../project/project.model';
import { getPluralKey } from '../../../util/get-plural-key';

const yieldAfterBulkDispatch = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

@Component({
  selector: 'task-selection-toolbar',
  templateUrl: './task-selection-toolbar.component.html',
  styleUrl: './task-selection-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MatIconButton, MatTooltip, TranslateModule],
})
export class TaskSelectionToolbarComponent {
  private readonly _selectionService = inject(TaskSelectionService);
  private readonly _taskService = inject(TaskService);
  private readonly _projectService = inject(ProjectService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskBatchOperationService = inject(TaskBatchOperationService);
  private readonly _translateService = inject(TranslateService);
  private readonly _translateStore = inject(TranslateStore);

  protected readonly selectedCount = this._selectionService.selectedCount;
  protected readonly T = T;
  protected readonly selectedCountMsg = computed(() =>
    getPluralKey(
      this._translateService,
      this._translateStore,
      this.selectedCount(),
      T.F.TASK.TASK_SELECTION.COUNT,
    ),
  );

  private readonly _selectedTasks = computed(() => {
    const ids = this._selectionService.selectedIds();
    const entities = this._taskService.taskEntities();
    return ids
      .map((id) => entities[id])
      .filter((task): task is TaskWithSubTasks => !!task);
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
            message: this._deleteConfirmMsg(),
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

  async markAsDone(): Promise<void> {
    const tasksToMarkDone = this._selectedTasks().filter((task) => !task.isDone);

    if (!tasksToMarkDone.length) {
      return;
    }

    for (const task of tasksToMarkDone) {
      this._taskService.setDone(task.id);
    }
    await yieldAfterBulkDispatch();
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

    for (const task of nonRecurringTasks) {
      await this._taskBatchOperationService.moveToProject(task, pickedProjectId);
    }
    if (nonRecurringTasks.length) {
      await yieldAfterBulkDispatch();
    }

    for (const task of recurringTasks) {
      await this._taskBatchOperationService.moveToProject(task, pickedProjectId);
    }
    this._selectionService.clearSelection();
  }

  clearSelection(): void {
    this._selectionService.clearSelection();
  }

  private _deleteConfirmMsg(): string {
    return getPluralKey(
      this._translateService,
      this._translateStore,
      this.selectedCount(),
      T.F.TASK.TASK_SELECTION.D_CONFIRM_DELETE.MSG,
    );
  }
}
