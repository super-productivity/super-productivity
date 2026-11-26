import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { ProjectService } from '../../features/project/project.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { TagService } from '../../features/tag/tag.service';
import { DataInitStateService } from '../data-init/data-init-state.service';
import { LOCAL_REST_API_FEATURE_ROUTES } from './local-rest-api-feature-routes';
import { createErrorResponse, createSuccessResponse } from './local-rest-api-response';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

const getQueryParam = (
  query: Record<string, string | string[]>,
  key: string,
): string | undefined => {
  const value = query[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Answers the Local REST API requests the main process forwards to the
 * renderer. The routes live with the features they expose and are provided as
 * `LOCAL_REST_API_FEATURE_ROUTES`; this service holds back requests until the
 * data has loaded, asks the routes in order, and turns an unanswered request
 * into a 404 and a thrown error into a 500.
 *
 * GET /projects and GET /tags are the exception: they are still served here,
 * which is what the two grandfathered features/ imports above are for.
 */
@Injectable({
  providedIn: 'root',
})
export class LocalRestApiRouterService {
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _featureRoutes = inject(LOCAL_REST_API_FEATURE_ROUTES);
  // The main process only knows the renderer has booted, which happens before
  // the data is loaded — answering then would serve an empty task list as if it
  // were the user's data, and let a write land on top of half-hydrated state.
  private readonly _isDataLoaded = toSignal(
    inject(DataInitStateService).isAllDataLoadedInitially$,
    { initialValue: false },
  );
  private _isInitialized = false;

  init(): void {
    if (this._isInitialized || !window.ea?.onLocalRestApiRequest) {
      return;
    }
    this._isInitialized = true;

    window.ea.onLocalRestApiRequest((payload) => {
      void this._handleRequest(payload);
    });
  }

  private async _handleRequest(payload: LocalRestApiRequestPayload): Promise<void> {
    let response: LocalRestApiResponsePayload;

    try {
      response = await this._routeRequest(payload);
    } catch (error) {
      response = createErrorResponse(
        payload.requestId,
        500,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unknown internal error',
      );
    }

    window.ea.sendLocalRestApiResponse(response);
  }

  private async _routeRequest(
    payload: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> {
    const { method, path, requestId, query } = payload;

    if (this._isDataLoaded() !== true) {
      return createErrorResponse(
        requestId,
        503,
        'APP_NOT_READY',
        'App data is still loading',
      );
    }

    // Served here until projects and tags get route providers of their own.
    if (method === 'GET' && path === '/projects') {
      return this._handleListProjects(requestId, query);
    }

    if (method === 'GET' && path === '/tags') {
      return this._handleListTags(requestId, query);
    }

    for (const routes of this._featureRoutes) {
      const response = await routes.handle(payload);
      if (response) {
        return response;
      }
    }

    return createErrorResponse(requestId, 404, 'NOT_FOUND', 'Route not found');
  }

  private async _handleListProjects(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const queryText = getQueryParam(query, 'query');

    let projects = await firstValueFrom(this._projectService.list$);

    if (queryText) {
      const lowerQuery = queryText.toLowerCase();
      projects = projects.filter((p) => p.title.toLowerCase().includes(lowerQuery));
    }

    return createSuccessResponse(requestId, 200, projects);
  }

  private async _handleListTags(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const queryText = getQueryParam(query, 'query');

    let tags = await firstValueFrom(this._tagService.tags$);

    if (queryText) {
      const lowerQuery = queryText.toLowerCase();
      tags = tags.filter((t) => t.title.toLowerCase().includes(lowerQuery));
    }

    return createSuccessResponse(requestId, 200, tags);
  }
}
