import { DestroyRef, inject, Injectable } from '@angular/core';
import { IS_ELECTRON } from '../../app.constants';
import { Log } from '../../core/log';
import { TaskBuilderService } from './task-builder.service';
import type {
  AddTaskPayload,
  AddTaskSubmitResult,
} from './add-task-bar/add-task-payload-builder';
import { isQuickAddWindowMode } from '../../util/is-quick-add-window-mode';
import { validateQuickAddTaskPayload } from './quick-add-task-payload-validator';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';

@Injectable({
  providedIn: 'root',
})
export class QuickAddTaskSubmitService {
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _taskBuilderService = inject(TaskBuilderService);
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private _isInitialized = false;

  init(): void {
    if (this._isInitialized || !IS_ELECTRON || isQuickAddWindowMode()) {
      return;
    }
    this._isInitialized = true;

    const unsubscribe = window.ea.onQuickAddTaskSubmitRequest((requestId, payload) => {
      void this._submitTask(requestId, payload);
    });
    this._destroyRef.onDestroy(unsubscribe);
    window.ea.informQuickAddTaskSubmitBridgeReady();
  }

  private async _submitTask(requestId: string, payload: AddTaskPayload): Promise<void> {
    const result = await this._buildSubmitResult(payload);
    window.ea.sendQuickAddTaskSubmitResponse(requestId, result);
  }

  private async _buildSubmitResult(
    payload: AddTaskPayload,
  ): Promise<AddTaskSubmitResult> {
    try {
      const validationError = validateQuickAddTaskPayload(payload, {
        projectIds: new Set(this._projectService.list().map((project) => project.id)),
        tagIds: new Set(this._tagService.tags().map((tag) => tag.id)),
      });
      if (validationError) {
        return { ok: false, error: validationError };
      }

      const taskId = await this._taskBuilderService.addTask(payload);
      return { ok: true, taskId };
    } catch (err) {
      Log.err('Quick Add task submit failed', err);
      return { ok: false, error: 'Unable to add task' };
    }
  }
}
