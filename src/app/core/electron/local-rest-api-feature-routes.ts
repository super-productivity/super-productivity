import { InjectionToken } from '@angular/core';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

/**
 * Local REST API routes that live with the feature they expose, so core/ does
 * not have to import features/ (see FEATURE_LAYER_FENCE in eslint.config.js).
 * Provided from the features side in main.ts with `multi: true`. The handler
 * asks them, in order, about every request none of its own routes match.
 */
export interface LocalRestApiFeatureRoutes {
  /** Resolves to undefined when the request is not one of this feature's routes. */
  handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined>;
}

export const LOCAL_REST_API_FEATURE_ROUTES = new InjectionToken<
  readonly LocalRestApiFeatureRoutes[]
>('LOCAL_REST_API_FEATURE_ROUTES');
