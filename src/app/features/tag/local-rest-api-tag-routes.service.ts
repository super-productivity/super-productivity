import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import typia, { IValidation } from 'typia';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  LocalRestApiResult,
  parseLocalRestApiBody,
} from '../../core/electron/local-rest-api-body';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { TODAY_TAG } from './tag.const';
import { Tag } from './tag.model';
import { TagService } from './tag.service';

interface UpdateTagFields {
  title?: string;
  icon?: string | null;
}

interface CreateTagFields extends UpdateTagFields {
  title: string;
}

const WRITABLE_KEYS: ReadonlySet<string> = new Set(['title', 'icon']);

/**
 * Trims and drops leading '#', which a user types out of habit: the task
 * editor's tag field and short syntax strip it too, so a tag created here
 * matches one typed as `#errands`.
 */
const normalizeTagTitle = (title: string): string =>
  title.trim().replace(/^#+/, '').trim();

/**
 * Local REST API write routes under `/tags`. `GET /tags` is served by the core
 * handler before feature routes run, so this only handles POST, PATCH and
 * DELETE.
 */
@Injectable()
export class LocalRestApiTagRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _tagService = inject(TagService);
  private readonly _store = inject(Store);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'tags') {
      return undefined;
    }

    if (segments.length === 1 && method === 'POST') {
      return this._handleCreate(requestId, body);
    }

    if (segments.length === 2) {
      const tagId = segments[1];
      if (method === 'PATCH') {
        return this._handleUpdate(requestId, tagId, body);
      }
      if (method === 'DELETE') {
        return this._handleDelete(requestId, tagId);
      }
    }

    return undefined;
  }

  private async _handleCreate(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseBody(requestId, body, (b) =>
      typia.validate<CreateTagFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const { title, icon } = parsed.value;

    // The task editor's tag field reuses a tag of the same title instead of
    // adding a second one; a caller that wants that gets the id from here.
    const existing = await this._findTagByTitle(title);
    if (existing) {
      return this._tagExists(requestId, existing);
    }

    // Like the create-tag dialog: color and theme come from the defaults.
    const tagId = this._tagService.addTag({
      title,
      ...(icon !== undefined ? { icon } : {}),
    });

    return createSuccessResponse(requestId, 201, await this._getTag(tagId));
  }

  private async _handleUpdate(
    requestId: string,
    tagId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    // The work-context menu offers no rename for Today either.
    if (tagId === TODAY_TAG.id) {
      return this._todayTagRefused(requestId, 'modified');
    }

    const parsed = this._parseBody(requestId, body, (b) =>
      typia.validate<UpdateTagFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const tag = await this._getTag(tagId);
    if (!tag) {
      return this._tagNotFound(requestId);
    }

    if (parsed.value.title !== undefined) {
      const existing = await this._findTagByTitle(parsed.value.title);
      if (existing && existing.id !== tagId) {
        return this._tagExists(requestId, existing);
      }
    }

    if (Object.keys(parsed.value).length > 0) {
      // The caller gets the result in the response; the app's "Tag updated"
      // snack would only interrupt whoever is using it.
      this._tagService.updateTag(tagId, parsed.value, true);
    }

    return createSuccessResponse(requestId, 200, await this._getTag(tagId));
  }

  private async _handleDelete(
    requestId: string,
    tagId: string,
  ): Promise<LocalRestApiResponsePayload> {
    // Only Today is protected: the work-context menu offers "Delete tag" for
    // every other tag, the board tags (urgent, important, in-progress)
    // included, and a board recreates those on demand.
    if (tagId === TODAY_TAG.id) {
      return this._todayTagRefused(requestId, 'deleted');
    }

    const tag = await this._getTag(tagId);
    if (!tag) {
      return this._tagNotFound(requestId);
    }

    // The UI's "Delete tag" strips the tag from its tasks, and deletes any
    // task left with no project and no tag, after a confirm dialog a REST
    // caller never sees. So a tag with tasks is refused like a non-empty
    // project; callers untag the tasks first.
    const taskCount = await this._countTasksWithTag(tagId);
    if (taskCount > 0) {
      return createErrorResponse(
        requestId,
        409,
        'TAG_NOT_EMPTY',
        `Tag still has ${taskCount} task${taskCount === 1 ? '' : 's'}; remove the tag from them before deleting it`,
        { taskCount },
      );
    }

    // As the UI's "Delete tag" does, this also removes the tag from archived
    // tasks and repeat configs (deleting those left with no project and no
    // tag) and deletes the tag's time-tracking data.
    this._tagService.deleteTag(tagId);

    return createSuccessResponse(requestId, 200, { deleted: true, id: tagId });
  }

  /**
   * Rejects a non-object body and keys other than title and icon, then
   * type-checks the rest. A title, where given, is normalized like one typed
   * in the app and must not end up empty.
   */
  private _parseBody<T extends UpdateTagFields>(
    requestId: string,
    body: unknown,
    validate: (body: Record<string, unknown>) => IValidation<T>,
  ): LocalRestApiResult<T> {
    const parsed = parseLocalRestApiBody(requestId, body, WRITABLE_KEYS, validate, 'tag');
    if (!parsed.ok || parsed.value.title === undefined) {
      return parsed;
    }
    const title = normalizeTagTitle(parsed.value.title);
    if (!title) {
      return {
        ok: false,
        response: this._invalid(
          requestId,
          'title must be a non-empty string, not counting a leading #',
        ),
      };
    }
    return { ok: true, value: { ...parsed.value, title } };
  }

  /**
   * Case-insensitive, as short syntax matches `#Errands` to a tag "errands".
   */
  private async _findTagByTitle(title: string): Promise<Tag | undefined> {
    const wanted = title.toLowerCase();
    const tags = await firstValueFrom(this._tagService.tags$);
    return tags.find((tag) => tag.title.toLowerCase() === wanted);
  }

  private _tagExists(requestId: string, existing: Tag): LocalRestApiResponsePayload {
    return createErrorResponse(
      requestId,
      409,
      'TAG_EXISTS',
      'A tag with this title already exists',
      { id: existing.id, title: existing.title },
    );
  }

  /**
   * Membership comes from `task.tagIds`, subtasks included, as in the delete
   * cascade; `tag.taskIds` only keeps the display order and can lag behind.
   */
  private async _countTasksWithTag(tagId: string): Promise<number> {
    const tasks = await firstValueFrom(this._store.select(selectAllTasks));
    return tasks.filter((task) => task.tagIds.includes(tagId)).length;
  }

  /**
   * By id equality over the list: the entity map lookup throws for unknown
   * ids and resolves ids like `__proto__` to prototype members.
   */
  private async _getTag(tagId: string): Promise<Tag | undefined> {
    const tags = await firstValueFrom(this._tagService.tags$);
    return tags.find((tag) => tag.id === tagId);
  }

  private _todayTagRefused(
    requestId: string,
    verb: 'modified' | 'deleted',
  ): LocalRestApiResponsePayload {
    return createErrorResponse(
      requestId,
      400,
      'UNSUPPORTED_FIELD',
      `The Today tag is virtual and cannot be ${verb}`,
    );
  }

  private _tagNotFound(requestId: string): LocalRestApiResponsePayload {
    return createErrorResponse(requestId, 404, 'TAG_NOT_FOUND', 'Tag not found');
  }

  private _invalid(
    requestId: string,
    message: string,
    details?: unknown,
  ): LocalRestApiResponsePayload {
    return createErrorResponse(requestId, 400, 'INVALID_INPUT', message, details);
  }
}
