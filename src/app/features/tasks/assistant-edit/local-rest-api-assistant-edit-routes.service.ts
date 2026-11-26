import { Injectable, inject } from '@angular/core';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  ASSISTANT_TASK_LOG_TIME_PATH,
  ASSISTANT_TASK_START_PATH,
  ASSISTANT_TASK_STOP_PATH,
  ASSISTANT_TASK_UPDATE_PATH,
} from '../../../../../electron/shared-with-frontend/assistant-access.model';
import { LocalRestApiFeatureRoutes } from '../../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../../core/electron/local-rest-api-response';
import { AssistantEditOutcome, AssistantEditService } from './assistant-edit.service';
import {
  parseAssistantLogTime,
  parseAssistantTaskId,
  parseAssistantTaskUpdate,
} from './assistant-edit-input';

const EDIT_PATHS: readonly string[] = [
  ASSISTANT_TASK_UPDATE_PATH,
  ASSISTANT_TASK_START_PATH,
  ASSISTANT_TASK_STOP_PATH,
  ASSISTANT_TASK_LOG_TIME_PATH,
];

const REJECTION_STATUS: Record<string, number> = {
  TASK_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  APP_BUSY: 503,
  PERSIST_DEGRADED: 503,
};

/**
 * The assistant (MCP) task edit routes, provided as a LOCAL_REST_API_FEATURE_ROUTES
 * entry. Like the capture route, they only exist for requests main marked as
 * coming from assistant access. A rejection means nothing was dispatched; its
 * code is all main passes on.
 */
@Injectable({ providedIn: 'root' })
export class LocalRestApiAssistantEditRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _assistantEditService = inject(AssistantEditService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    if (
      !EDIT_PATHS.includes(request.path) ||
      request.source !== 'mcp' ||
      request.method !== 'POST'
    ) {
      return undefined;
    }
    const outcome = await this._run(request);
    if (!outcome) {
      return createErrorResponse(request.requestId, 400, 'INVALID_INPUT', 'Invalid edit');
    }
    if ('rejection' in outcome) {
      return createErrorResponse(
        request.requestId,
        REJECTION_STATUS[outcome.rejection] ?? 409,
        outcome.rejection,
        outcome.rejection,
      );
    }
    return createSuccessResponse(request.requestId, 200, outcome.result);
  }

  private _run(
    request: LocalRestApiRequestPayload,
  ): Promise<AssistantEditOutcome> | undefined {
    switch (request.path) {
      case ASSISTANT_TASK_UPDATE_PATH: {
        const update = parseAssistantTaskUpdate(request.body);
        return update && this._assistantEditService.updateTask(update);
      }
      case ASSISTANT_TASK_START_PATH: {
        const id = parseAssistantTaskId(request.body);
        return id === undefined
          ? undefined
          : this._assistantEditService.startTracking(id);
      }
      case ASSISTANT_TASK_STOP_PATH:
        return request.body === undefined ||
          (typeof request.body === 'object' &&
            request.body !== null &&
            Object.keys(request.body).length === 0)
          ? this._assistantEditService.stopTracking()
          : undefined;
      default: {
        const input = parseAssistantLogTime(request.body);
        return input && this._assistantEditService.logTime(input);
      }
    }
  }
}
