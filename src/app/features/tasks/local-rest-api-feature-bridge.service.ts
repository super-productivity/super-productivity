import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { LocalRestApiFeatureBridge } from '../../core/electron/local-rest-api-feature-bridge';
import { AssistantCaptureInput } from '../../core/electron/assistant-capture-input';
import { AssistantCaptureResult } from '../../../../electron/shared-with-frontend/assistant-access.model';
import { TaskLog } from '../../core/log';
import { IssueService } from '../issue/issue.service';
import { IssueProviderKey } from '../issue/issue.model';
import { addSubTask } from './store/task.actions';
import { Task } from './task.model';
import { TaskService } from './task.service';
import { AssistantCaptureService } from './assistant-capture/assistant-capture.service';

/** Features-side implementation of `LOCAL_REST_API_FEATURE_BRIDGE`. */
@Injectable()
export class LocalRestApiFeatureBridgeService implements LocalRestApiFeatureBridge {
  private readonly _issueService = inject(IssueService);
  private readonly _taskService = inject(TaskService);
  private readonly _store = inject(Store);
  private readonly _assistantCaptureService = inject(AssistantCaptureService);

  issueLink(
    issueType: IssueProviderKey,
    issueId: string | number,
    issueProviderId: string,
  ): Promise<string> {
    return this._issueService.issueLink(issueType, issueId, issueProviderId);
  }

  /**
   * `TaskService.addSubTaskTo` with short syntax switched off. Kept here
   * rather than as a flag on the service, which is already over the size cap.
   */
  addLiteralSubTask(parentId: string, additional: Partial<Task>): string {
    const task = this._taskService.createNewTaskWithDefaults({
      title: additional.title || '',
      additional: { dueDay: additional.dueDay || undefined, ...additional },
    });
    TaskLog.log('addSubTaskTo', { taskId: task.id, parentId });
    this._store.dispatch(addSubTask({ task, parentId, isIgnoreShortSyntax: true }));
    return task.id;
  }

  captureAssistantTask(input: AssistantCaptureInput): Promise<AssistantCaptureResult> {
    return this._assistantCaptureService.capture(input);
  }
}
