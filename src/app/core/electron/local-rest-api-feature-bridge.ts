import { InjectionToken } from '@angular/core';

/**
 * Feature calls the Local REST API handler makes without importing features/
 * (core/ must not — see FEATURE_LAYER_FENCE in eslint.config.js). Provided
 * from the features side in main.ts.
 */
export interface LocalRestApiFeatureBridge {
  /** Web link to the issue a task was imported from; '' when there is none. */
  issueLink(
    issueType: string,
    issueId: string | number,
    issueProviderId: string,
  ): Promise<string>;

  /** Adds a subtask whose title is kept as is (no short syntax); returns its id. */
  addLiteralSubTask(parentId: string, fields: object): string;
}

export const LOCAL_REST_API_FEATURE_BRIDGE =
  new InjectionToken<LocalRestApiFeatureBridge>('LOCAL_REST_API_FEATURE_BRIDGE');
