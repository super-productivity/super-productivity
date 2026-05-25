import { Injectable, inject } from '@angular/core';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { Store } from '@ngrx/store';
import { selectTasksWithSubTasksByIds } from '../tasks/store/task.selectors';
import { Task, TaskWithSubTasks } from '../tasks/task.model';
import { first } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class WorkContextMarkdownService {
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _store = inject(Store);

  async copyTasksAsMarkdown(
    contextId: string,
    isProjectContext: boolean,
  ): Promise<'copied' | 'empty' | 'failed'> {
    const { status, markdown } = await this.getMarkdownForContext(
      contextId,
      isProjectContext,
    );

    if (status === 'empty' || !markdown) {
      return 'empty';
    }

    const isSuccess = await this.copyMarkdownText(markdown);
    return isSuccess ? 'copied' : 'failed';
  }

  async getMarkdownForContext(
    contextId: string,
    isProjectContext: boolean,
  ): Promise<{
    status: 'empty' | 'ok';
    markdown?: string;
    contextTitle?: string | null;
  }> {
    const { tasks, contextTitle } = await this._loadTasks(contextId, isProjectContext);

    if (!tasks.length) {
      return { status: 'empty', contextTitle };
    }

    return {
      status: 'ok',
      markdown: this._buildMarkdownChecklist(tasks),
      contextTitle,
    };
  }

  async copyMarkdownText(markdown: string): Promise<boolean> {
    if (!markdown) {
      return false;
    }
    return this._copyToClipboard(markdown);
  }

  private async _loadTasks(
    contextId: string,
    isProjectContext: boolean,
  ): Promise<{ tasks: TaskWithSubTasks[]; contextTitle: string | null }> {
    const { ids, contextTitle } = await this._getTaskIds(contextId, isProjectContext);

    if (!ids.length) {
      return { tasks: [], contextTitle };
    }

    const tasks =
      (await this._store
        .select(selectTasksWithSubTasksByIds, { ids })
        .pipe(first())
        .toPromise()) || [];

    return {
      tasks: tasks.filter((task): task is TaskWithSubTasks => !!task),
      contextTitle,
    };
  }

  private async _getTaskIds(
    contextId: string,
    isProjectContext: boolean,
  ): Promise<{ ids: string[]; contextTitle: string | null }> {
    if (isProjectContext) {
      const project = await this._projectService.getByIdOnce$(contextId).toPromise();
      if (!project) {
        return { ids: [], contextTitle: null };
      }
      return {
        ids: this._uniqueIds([
          ...(project.taskIds || []),
          ...(project.backlogTaskIds || []),
        ]),
        contextTitle: project.title,
      };
    }

    const tag = await this._tagService.getTagById$(contextId).pipe(first()).toPromise();

    if (!tag) {
      return { ids: [], contextTitle: null };
    }

    return { ids: this._uniqueIds(tag.taskIds || []), contextTitle: tag.title };
  }

  private _uniqueIds(ids: (string | null | undefined)[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    ids.forEach((id) => {
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      unique.push(id);
    });

    return unique;
  }

  private _buildMarkdownChecklist(tasks: TaskWithSubTasks[]): string {
    const lines: string[] = [];

    tasks.forEach((task) => {
      lines.push(this._formatTaskLine(task));

      if (task.subTasks?.length) {
        task.subTasks.forEach((subTask) => {
          lines.push(this._formatTaskLine(subTask, 1));
        });
      }
    });

    return lines.join('\n');
  }

  private _formatTaskLine(task: Task | TaskWithSubTasks, depth: number = 0): string {
    const indent = depth > 0 ? '  '.repeat(depth) : '';
    const checkbox = task.isDone ? '[x]' : '[ ]';
    const title = (task.title || '').replace(/\r?\n/g, ' ');
    return `${indent}- ${checkbox} ${title}`;
  }

  private async _copyToClipboard(text: string): Promise<boolean> {
    if (!text) {
      return false;
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('Clipboard write failed, trying fallback method:', err);
      }
    }

    if (typeof document === 'undefined') {
      return false;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let isSuccess = false;
    try {
      isSuccess = document.execCommand('copy');
    } catch (err) {
      console.error('Fallback copy failed:', err);
      isSuccess = false;
    } finally {
      document.body.removeChild(textarea);
    }

    return isSuccess;
  }
}
