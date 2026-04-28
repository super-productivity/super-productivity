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
import { parseTimeSpentChanges } from './short-syntax';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { Task } from './task.model';
import { SectionService } from '../section/section.service';
import { WorkContextService } from '../work-context/work-context.service';
import type { MarkdownWithSections } from '../../util/parse-markdown-tasks';

// Anchored at line start: ATX header (#…) or list-item marker (-/* with
// optional checkbox). One-shot regex that bails before invoking the full
// parsers on plain-text pastes.
const MARKDOWN_TASK_OR_HEADER_RE = /^(?:#{1,6}\s|\s*[-*]\s)/m;

@Injectable({
  providedIn: 'root',
})
export class MarkdownPasteService {
  private _matDialog = inject(MatDialog);
  private _taskService = inject(TaskService);
  private _store = inject(Store);
  private _globalConfigService = inject(GlobalConfigService);
  private _sectionService = inject(SectionService);
  private _workContextService = inject(WorkContextService);

  // Single-slot memo for the sectioned parse result. `isMarkdownTaskList`
  // runs first (paste-gate) and `handleMarkdownPaste` runs immediately
  // after with the same string — without this, the parser ran twice.
  // Cleared after consumption so a large clipboard payload (up to ~800KB)
  // does not stay resident for the rest of the session.
  private _lastSectionInput: string | null = null;
  private _lastSectionResult: MarkdownWithSections | null = null;

  private _parseSectionsCached(text: string): MarkdownWithSections | null {
    if (text !== this._lastSectionInput) {
      this._lastSectionInput = text;
      this._lastSectionResult = parseMarkdownWithSections(text);
    }
    return this._lastSectionResult;
  }

  private _clearSectionsCache(): void {
    this._lastSectionInput = null;
    this._lastSectionResult = null;
  }

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
      const sectionsData = this._parseSectionsCached(pastedText);
      if (sectionsData) {
        // Confirm with user
        const totalTasks = sectionsData.sections.reduce(
          (sum: number, section) => sum + section.tasks.length,
          0,
        );
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
        // Drop the cached parse result regardless of confirmation —
        // the memo is only useful for the gate→handler back-to-back call.
        this._clearSectionsCache();
        if (!isConfirmed) {
          return;
        }

        const workContextId = this._workContextService.activeWorkContextId;
        const sectionContextType = this._workContextService.activeWorkContextType;
        if (!workContextId || !sectionContextType) {
          return;
        }

        // ATOMICITY NOTE — paste creates one section + N tasks + M sub-tasks.
        // Each call below dispatches a separate action and produces a separate
        // op-log entry. A sync push that lands mid-paste can leave a partial
        // state on remote clients (e.g. a section with no tasks). The proper
        // fix is a single bulk action reduced atomically across the
        // task/section/project/tag reducers — tracked as follow-up.
        // For now we do NOT yield to the event loop between dispatches: a
        // mid-loop yield would widen the interleave window with concurrent
        // sync replay (CLAUDE.md item 11 yields *after* a bulk apply, not
        // inside one). The dispatches are synchronous so the whole paste
        // completes in a single tick; a 100-task paste blocks for a few ms.
        for (const section of sectionsData.sections) {
          const sectionId = section.sectionTitle
            ? this._sectionService.addSection(
                section.sectionTitle,
                workContextId,
                sectionContextType,
              )
            : null;

          for (const task of section.tasks) {
            const taskId = this._taskService.add(
              task.title,
              false,
              {
                isDone: task.isCompleted,
                notes: task.notes,
              },
              true,
            );

            if (sectionId) {
              this._sectionService.addTaskToSection(sectionId, taskId, null, null);
            }

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
                this._store.dispatch(addSubTask({ task: subTaskObj, parentId: taskId }));
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
    // Cheap pre-screen — bails out for plain-text pastes (the common
    // case for Ctrl+V) before invoking the full parsers, which would
    // otherwise scan the whole input even for 800KB of prose.
    if (!MARKDOWN_TASK_OR_HEADER_RE.test(text)) return false;

    // Sectioned (H1+) markdown — parseMarkdownWithSections already
    // returns null for header-less input. Result is memoised so the
    // immediately-following handleMarkdownPaste reuses it.
    if (this._parseSectionsCached(text)) return true;

    // Flat task list fallback
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
