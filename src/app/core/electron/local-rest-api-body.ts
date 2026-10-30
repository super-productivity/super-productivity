import { IValidation } from 'typia';
import { LocalRestApiResponsePayload } from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { createErrorResponse } from './local-rest-api-response';

/**
 * Request body parsing shared by the feature-owned Local REST API route
 * modules (LOCAL_REST_API_FEATURE_ROUTES).
 */

/** A parsed value, or the error response to send instead. */
export type LocalRestApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: LocalRestApiResponsePayload };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Accepts a JSON object body holding only `allowedKeys` whose fields pass
 * `validate` (a `typia.validate<T>` call, which must stay at the call site).
 * `subject` names the entity in the type error message, e.g. `note`.
 */
export const parseLocalRestApiBody = <T>(
  requestId: string,
  body: unknown,
  allowedKeys: ReadonlySet<string>,
  validate: (body: Record<string, unknown>) => IValidation<T>,
  subject: string,
): LocalRestApiResult<T> => {
  if (!isRecord(body)) {
    return {
      ok: false,
      response: createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        'Request body must be a JSON object',
      ),
    };
  }

  const unsupported = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    return {
      ok: false,
      response: createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        `Field(s) cannot be set through this endpoint: ${unsupported.join(', ')}`,
        { fields: unsupported },
      ),
    };
  }

  const validation = validate(body);
  if (!validation.success) {
    return {
      ok: false,
      response: createErrorResponse(
        requestId,
        400,
        'INVALID_INPUT',
        `One or more ${subject} fields have an invalid type`,
        validation.errors.map(({ path, expected }) => ({ path, expected })),
      ),
    };
  }
  return { ok: true, value: validation.data };
};
