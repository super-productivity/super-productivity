import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import {
  parseMarkdownTasks,
  convertToMarkdownNotes,
  parseMarkdownTasksWithStructure,
} from '../../util/parse-markdown-tasks';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../t.const';
import { TaskService } from './task.service';
import { addSubTask } from './store/task.actions';
import { parseTimeSpentChanges } from './short-syntax';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { Task } from './task.model';

@Injectable({
  providedIn: 'root',
})
export class MarkdownPasteService {
  private _matDialog = inject(MatDialog);
  private _taskService = inject(TaskService);
  private _store = inject(Store);
  private _globalConfigService = inject(GlobalConfigService);

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
              const { title, timeProps } = this._parseTimeProps(subTask.title);
              const subTaskObj = this._taskService.createNewTaskWithDefaults({
                title,
                additional: {
                  isDone: subTask.isCompleted,
                  parentId: parentTaskId,
                  notes: subTask.notes,
                  ...timeProps,
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
        const { title, timeProps } = this._parseTimeProps(parsedTask.title);
        const subTask = this._taskService.createNewTaskWithDefaults({
          title,
          additional: {
            isDone: parsedTask.isCompleted,
            parentId: selectedTaskId,
            notes: parsedTask.notes,
            ...timeProps,
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

  // isEnableDue gates both due-date and time estimation parsing,
  // matching the behavior in short-syntax.effects.ts
  private _parseTimeProps(originalTitle: string): {
    title: string;
    timeProps: Partial<Task>;
  } {
    const shortSyntaxConfig =
      this._globalConfigService.cfg()?.shortSyntax || DEFAULT_GLOBAL_CONFIG.shortSyntax;
    if (!shortSyntaxConfig.isEnableDue) {
      return { title: originalTitle, timeProps: {} };
    }
    const { title: cleanedTitle, ...timeProps } = parseTimeSpentChanges({
      title: originalTitle,
    });
    return { title: cleanedTitle ?? originalTitle, timeProps };
  }
}
