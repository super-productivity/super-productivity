import { Injectable, inject } from '@angular/core';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../../electron/shared-with-frontend/local-rest-api.model';
import { ASSISTANT_CAPTURE_PATH } from '../../../../../electron/shared-with-frontend/assistant-access.model';
import { LocalRestApiFeatureRoutes } from '../../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../../core/electron/local-rest-api-response';
import {
  AssistantCaptureService,
  parseAssistantCaptureInput,
} from './assistant-capture.service';

/** The assistant (MCP) capture route, provided as a LOCAL_REST_API_FEATURE_ROUTES entry. */
@Injectable({ providedIn: 'root' })
export class LocalRestApiAssistantCaptureRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _assistantCaptureService = inject(AssistantCaptureService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    // Only the main process can mark a request as coming from assistant (MCP)
    // access; over plain REST this route does not exist.
    if (
      request.path !== ASSISTANT_CAPTURE_PATH ||
      request.source !== 'mcp' ||
      request.method !== 'POST'
    ) {
      return undefined;
    }

    const input = parseAssistantCaptureInput(request.body);
    if (!input) {
      return createErrorResponse(
        request.requestId,
        400,
        'INVALID_INPUT',
        'Invalid capture',
      );
    }
    return createSuccessResponse(
      request.requestId,
      200,
      await this._assistantCaptureService.capture(input),
    );
  }
}
