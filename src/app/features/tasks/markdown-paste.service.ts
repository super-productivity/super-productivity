import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import {
  parseMarkdownTasks,
  convertToMarkdownNotes,
  parseMarkdownTasksWithStructure,
  parseMarkdownWithSections,
} from '../../util/parse-markdown-tasks';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../t.const';
import { TaskService } from './task.service';
import { addSubTask } from './store/task.actions';
import { SectionService } from '../section/section.service';
import { WorkContextService } from '../work-context/work-context.service';

@Injectable({
  providedIn: 'root',
})
export class MarkdownPasteService {
  private _matDialog = inject(MatDialog);
  private _taskService = inject(TaskService);
  private _store = inject(Store);
  private _sectionService = inject(SectionService);
  private _workContextService = inject(WorkContextService);

  async handleMarkdownPaste(
    pastedText: string,
    selectedTaskId: string | null = null,
    selectedTaskTitle?: string,
    isSelectedTaskSubTask?: boolean,
  ): Promise<void> {
    // Special handling for sub-tasks - add to notes instead of creating sub-tasks
    if (selectedTaskId && isSelectedTaskSubTask) {
      const convertedNotes = convertToMarkdownNotes(pastedText);
      if (!convertedNotes) {
        return;
      }

      const dialogRef = this._matDialog.open(DialogConfirmComponent, {
        data: {
          okTxt: T.G.CONFIRM,
          message: T.F.MARKDOWN_PASTE.CONFIRM_ADD_TO_SUB_TASK_NOTES,
          translateParams: {
            parentTaskTitle: selectedTaskTitle,
          },
        },
      });

      const isConfirmed = await dialogRef.afterClosed().toPromise();
      if (!isConfirmed) {
        return;
      }

      // Get current task and append to notes
      const currentTask = await this._taskService
        .getByIdOnce$(selectedTaskId)
        .toPromise();
      if (currentTask) {
        const existingNotes = currentTask.notes || '';
        const newNotes = existingNotes
          ? `${existingNotes}\n\n${convertedNotes}`
          : convertedNotes;

        this._taskService.update(selectedTaskId, { notes: newNotes });
      }
      return;
    }

    // Try to parse with sections first (for markdown with H1 headers)
    if (!selectedTaskId) {
      const sectionsData = parseMarkdownWithSections(pastedText);
      if (sectionsData && sectionsData.hasHeaders) {
        // Confirm with user
        const totalTasks = sectionsData.sections.reduce((sum, section) => sum + section.tasks.length, 0);
        const dialogRef = this._matDialog.open(DialogConfirmComponent, {
          data: {
            okTxt: T.G.CONFIRM,
            title: T.F.MARKDOWN_PASTE.DIALOG_TITLE,
            titleIcon: 'content_paste',
            message: T.F.MARKDOWN_PASTE.CONFIRM_SECTIONS,
            translateParams: {
              sectionsCount: sectionsData.sections.length,
              tasksCount: totalTasks,
            },
          },
        });

        const isConfirmed = await dialogRef.afterClosed().toPromise();
        if (!isConfirmed) {
          return;
        }

        const workContextId = this._workContextService.activeWorkContextId;

        // Create sections and tasks
        for (const section of sectionsData.sections) {
          let sectionId: string | null = null;

          // Create section if it has a title
          if (section.sectionTitle) {
            // Generate ID locally to avoid async wait issues
            sectionId = this._sectionService.generateSectionId();
            this._sectionService.addSectionWithId(sectionId, section.sectionTitle, workContextId);
          }

          // Create tasks for this section
          for (const task of section.tasks) {
            const taskId = this._taskService.add(
              task.title,
              false,
              {
                isDone: task.isCompleted,
                notes: task.notes,
                sectionId: sectionId,
              },
              true,
            );

            // Create sub-tasks if any
            if (task.subTasks && task.subTasks.length > 0) {
              for (const subTask of task.subTasks) {
                const subTaskObj = this._taskService.createNewTaskWithDefaults({
                  title: subTask.title,
                  additional: {
                    isDone: subTask.isCompleted,
                    parentId: taskId,
                    notes: subTask.notes,
                  },
                });
                this._store.dispatch(
                  addSubTask({ task: subTaskObj, parentId: taskId }),
                );
              }
            }
          }
        }
        return;
      }
    }

    // Try to parse with structure first (for creating sub-tasks when no task selected)
    if (!selectedTaskId) {
      const structure = parseMarkdownTasksWithStructure(pastedText);
      if (structure) {
        // Use structured parsing for parent tasks (with or without sub-tasks)
        const dialogRef = this._matDialog.open(DialogConfirmComponent, {
          data: {
            okTxt: T.G.CONFIRM,
            title: T.F.MARKDOWN_PASTE.DIALOG_TITLE,
            titleIcon: 'content_paste',
            message:
              structure.totalSubTasks > 0
                ? T.F.MARKDOWN_PASTE.CONFIRM_PARENT_TASKS_WITH_SUBS
                : T.F.MARKDOWN_PASTE.CONFIRM_PARENT_TASKS,
            translateParams: {
              tasksCount: structure.mainTasks.length,
              subTasksCount: structure.totalSubTasks,
            },
          },
        });

        const isConfirmed = await dialogRef.afterClosed().toPromise();
        if (!isConfirmed) {
          return;
        }

        // Create parent tasks with sub-tasks
        for (const mainTask of structure.mainTasks) {
          const parentTaskId = this._taskService.add(
            mainTask.title,
            false,
            {
              isDone: mainTask.isCompleted,
              notes: mainTask.notes,
            },
            true,
          );

          // Create sub-tasks if any
          if (mainTask.subTasks && mainTask.subTasks.length > 0) {
            for (const subTask of mainTask.subTasks) {
              const subTaskObj = this._taskService.createNewTaskWithDefaults({
                title: subTask.title,
                additional: {
                  isDone: subTask.isCompleted,
                  parentId: parentTaskId,
                  notes: subTask.notes,
                },
              });
              this._store.dispatch(
                addSubTask({ task: subTaskObj, parentId: parentTaskId }),
              );
            }
          }
        }
        return;
      }
    }

    // Normal handling for simple lists or selected task sub-tasks
    const parsedTasks = parseMarkdownTasks(pastedText);
    if (!parsedTasks || parsedTasks.length === 0) {
      return;
    }

    const dialogRef = this._matDialog.open(DialogConfirmComponent, {
      data: {
        okTxt: T.G.CONFIRM,
        message: selectedTaskId
          ? selectedTaskTitle
            ? T.F.MARKDOWN_PASTE.CONFIRM_SUB_TASKS_WITH_PARENT
            : T.F.MARKDOWN_PASTE.CONFIRM_SUB_TASKS
          : T.F.MARKDOWN_PASTE.CONFIRM_PARENT_TASKS,
        translateParams: {
          tasksCount: parsedTasks.length,
          parentTaskTitle: selectedTaskTitle,
        },
      },
    });

    const isConfirmed = await dialogRef.afterClosed().toPromise();
    if (!isConfirmed) {
      return;
    }

    if (selectedTaskId) {
      // Create as sub-tasks of the selected task
      for (const parsedTask of parsedTasks) {
        const subTask = this._taskService.createNewTaskWithDefaults({
          title: parsedTask.title,
          additional: {
            isDone: parsedTask.isCompleted,
            parentId: selectedTaskId,
            notes: parsedTask.notes,
          },
        });
        this._store.dispatch(addSubTask({ task: subTask, parentId: selectedTaskId }));
      }
    } else {
      // Create as parent tasks (simple list without nesting)
      for (const parsedTask of parsedTasks) {
        this._taskService.add(
          parsedTask.title,
          false,
          {
            isDone: parsedTask.isCompleted,
            notes: parsedTask.notes,
          },
          true,
        );
      }
    }
  }

  isMarkdownTaskList(text: string): boolean {
    const parsedTasks = parseMarkdownTasks(text);
    return parsedTasks !== null && parsedTasks.length > 0;
  }
}
