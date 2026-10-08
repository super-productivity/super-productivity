import { LocalRestApiResponsePayload } from '../../../../electron/shared-with-frontend/local-rest-api.model';

/**
 * Response envelope builders shared by the Local REST API route modules.
 * Kept in their own file so both the main handler service and the
 * feature-owned routes (LOCAL_REST_API_FEATURE_ROUTES) can build responses
 * without importing each other.
 */
export const createErrorResponse = (
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): LocalRestApiResponsePayload => ({
  requestId,
  status,
  body: {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  },
});

export const createSuccessResponse = (
  requestId: string,
  status: number,
  data: unknown,
): LocalRestApiResponsePayload => ({
  requestId,
  status,
  body: {
    ok: true,
    data,
  },
});
