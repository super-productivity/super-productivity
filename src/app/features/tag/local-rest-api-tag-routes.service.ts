import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import typia from 'typia';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { DEFAULT_TAG_COLOR } from '../work-context/work-context.const';
import { TagService } from './tag.service';
import { Tag } from './tag.model';

/**
 * The fields the create-tag and tag settings dialogs write. Other keys are
 * ignored, as for tasks.
 */
const ALLOWED_TAG_FIELDS: ReadonlySet<string> = new Set(['title', 'icon', 'color']);

/**
 * Rejected rather than ignored: `taskIds` is the tag's task ordering, kept
 * in sync by the task reducers, and callers that try to tag tasks this way
 * should be told to use `tagIds` on the task instead.
 */
const REJECTED_TAG_FIELDS = ['taskIds'] as const;

interface WritableTagFields {
  title?: string;
  icon?: string | null;
  color?: string;
}

/** The `#rgb` / `#rrggbb` form the app's color picker produces. */
const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const TITLE_ERROR = 'Tag title must be a non-empty string';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type BodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: LocalRestApiResponsePayload };

/** Local REST API routes under `/tags/` that write or read a single tag. */
@Injectable()
export class LocalRestApiTagRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _tagService = inject(TagService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'tags') {
      return undefined;
    }

    if (segments.length === 1 && method === 'POST') {
      return this._handleCreateTag(requestId, body);
    }

    if (segments.length === 2) {
      const tagId = segments[1];
      if (method === 'GET') {
        return this._handleGetTag(requestId, tagId);
      }
      if (method === 'PATCH') {
        return this._handleUpdateTag(requestId, tagId, body);
      }
    }

    return undefined;
  }

  private async _handleGetTag(
    requestId: string,
    tagId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const tag = await this._getTag(tagId);
    if (!tag) {
      return this._tagNotFound(requestId);
    }
    return createSuccessResponse(requestId, 200, tag);
  }

  private async _handleCreateTag(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseTagFields(requestId, body);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (parsed.value.title === undefined) {
      return this._invalid(requestId, TITLE_ERROR).response;
    }

    // Same as the create-tag dialog: TagService fills in the defaults and a
    // random preset color when none is given.
    const tagId = this._tagService.addTag(parsed.value);

    return createSuccessResponse(requestId, 201, await this._getTag(tagId));
  }

  private async _handleUpdateTag(
    requestId: string,
    tagId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseTagFields(requestId, body);
    if (!parsed.ok) {
      return parsed.response;
    }

    const tag = await this._getTag(tagId);
    if (!tag) {
      return this._tagNotFound(requestId);
    }

    const { color, ...rest } = parsed.value;
    // Like the tag settings dialog: theme.primary follows the tag color unless
    // the user picked a different primary color on purpose.
    const primary = tag.theme?.primary;
    const isPrimaryCustomized = primary !== DEFAULT_TAG_COLOR && primary !== tag.color;
    const changes: Partial<Tag> = {
      ...rest,
      ...(color !== undefined ? { color } : {}),
      ...(color !== undefined && !isPrimaryCustomized
        ? { theme: { ...tag.theme, primary: color } }
        : {}),
    };
    if (Object.keys(changes).length > 0) {
      this._tagService.updateTag(tagId, changes);
    }

    return createSuccessResponse(requestId, 200, await this._getTag(tagId));
  }

  private _parseTagFields(
    requestId: string,
    body: unknown,
  ): BodyResult<WritableTagFields> {
    if (!isRecord(body)) {
      return this._invalid(requestId, 'Request body must be a JSON object');
    }

    const rejected = REJECTED_TAG_FIELDS.find((field) => field in body);
    if (rejected) {
      return {
        ok: false,
        response: createErrorResponse(
          requestId,
          400,
          'UNSUPPORTED_FIELD',
          `${rejected} cannot be set via the tag REST API — set tagIds on the task with PATCH /tasks/:id instead`,
        ),
      };
    }

    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (ALLOWED_TAG_FIELDS.has(key)) {
        fields[key] = body[key];
      }
    }

    const validation = typia.validate<WritableTagFields>(fields);
    if (!validation.success) {
      return this._invalid(
        requestId,
        'One or more tag fields have an invalid type',
        validation.errors.map(({ path, expected }) => ({ path, expected })),
      );
    }

    const value = validation.data;
    if (value.color !== undefined && !HEX_COLOR_REGEX.test(value.color)) {
      return this._invalid(requestId, 'color must be a #rgb or #rrggbb color');
    }
    if (value.title !== undefined) {
      const title = value.title.trim();
      if (!title) {
        return this._invalid(requestId, TITLE_ERROR);
      }
      return { ok: true, value: { ...value, title } };
    }
    return { ok: true, value };
  }

  /** By id equality, so ids like `__proto__` can't resolve to prototype members. */
  private async _getTag(tagId: string): Promise<Tag | undefined> {
    const tags = await firstValueFrom(this._tagService.tags$);
    return tags.find((tag) => tag.id === tagId);
  }

  private _tagNotFound(requestId: string): LocalRestApiResponsePayload {
    return createErrorResponse(requestId, 404, 'TAG_NOT_FOUND', 'Tag not found');
  }

  private _invalid(
    requestId: string,
    message: string,
    details?: unknown,
  ): { ok: false; response: LocalRestApiResponsePayload } {
    return {
      ok: false,
      response: createErrorResponse(requestId, 400, 'INVALID_INPUT', message, details),
    };
  }
}
