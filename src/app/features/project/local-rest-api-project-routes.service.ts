import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
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
import { INBOX_PROJECT } from './project.const';
import { Project } from './project.model';
import { ProjectService } from './project.service';
import { archiveProject, unarchiveProject } from './store/project.actions';

/** Keep project REST writes to scalar/basic fields. Task and note lists are reducer-owned. */
const ALLOWED_PROJECT_FIELDS = new Set<string>([
  'title',
  'icon',
  'isHiddenFromMenu',
  'isEnableBacklog',
]);

/**
 * Relational fields that callers often try to set but must be rejected:
 * mutating them as plain values corrupts invariants (task/backlog/note
 * membership is maintained by the task & note reducers when tasks and notes
 * are added, moved or removed).
 */
const REJECTED_PROJECT_FIELDS = ['taskIds', 'backlogTaskIds', 'noteIds'] as const;

/**
 * Value-level types for the fields writable via the project REST API. Keys
 * mirror ALLOWED_PROJECT_FIELDS; without this a caller could push a
 * wrong-typed value (e.g. `isEnableBacklog: 1`) straight into the store and
 * the synced op-log, where it corrupts state locally and trips
 * typia-as-corrupt on other devices when the op replays.
 */
interface WritableProjectFields {
  title?: string;
  icon?: string;
  isHiddenFromMenu?: boolean;
  isEnableBacklog?: boolean;
}

type FieldTypeError = { path: string; expected: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pickAllowedProjectFields = (
  body: Record<string, unknown>,
): Partial<WritableProjectFields> => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_PROJECT_FIELDS.has(key)) {
      result[key] =
        key === 'title' && typeof body[key] === 'string' ? body[key].trim() : body[key];
    }
  }
  return result;
};

const firstRejectedProjectField = (body: Record<string, unknown>): string | undefined =>
  REJECTED_PROJECT_FIELDS.find((field) => field in body);

/**
 * Validates the value types of already-key-filtered project fields, mirroring
 * `validateWritableFields` for tasks in the handler service. Rejects bad
 * input with a clean 400 before anything is dispatched.
 */
const validateWritableProjectFields = (
  fields: Partial<WritableProjectFields>,
): { ok: true } | { ok: false; errors: FieldTypeError[] } => {
  const result = typia.validate<WritableProjectFields>(fields);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.errors.map((e) => ({ path: e.path, expected: e.expected })),
  };
};

const TITLE_ERROR = 'Project title must be a non-empty string';

const invalidInput = (
  requestId: string,
  message: string,
  details?: unknown,
): LocalRestApiResponsePayload =>
  createErrorResponse(requestId, 400, 'INVALID_INPUT', message, details);

const projectNotFound = (requestId: string): LocalRestApiResponsePayload =>
  createErrorResponse(requestId, 404, 'PROJECT_NOT_FOUND', 'Project not found');

/**
 * Write routes for `/projects`, owned by the project feature.
 *
 * The local REST API's core handler cannot import from `features/` (the eslint
 * layer fence), so feature routes register themselves through
 * `LOCAL_REST_API_FEATURE_ROUTES` instead — see that token's doc comment. The
 * read-only list (`GET /projects`) stays in the core handler; this service
 * answers only the requests that need the project feature's own services.
 */
@Injectable()
export class LocalRestApiProjectRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _projectService = inject(ProjectService);
  private readonly _store = inject(Store);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'projects') {
      return undefined;
    }

    if (segments.length === 1) {
      // `GET /projects` (the list) is a core route and never reaches here in the
      // app; return undefined so the handler above keeps owning it. Creation is
      // ours, and any other verb is a known path with an unsupported method.
      if (method === 'GET') {
        return undefined;
      }
      return method === 'POST'
        ? this._handleCreate(requestId, body)
        : this._methodNotAllowed(requestId, ['GET', 'POST']);
    }

    if (segments.length === 2) {
      const projectId = segments[1];
      if (method === 'GET') {
        return this._handleGet(requestId, projectId);
      }
      if (method === 'PATCH') {
        return this._handleUpdate(requestId, projectId, body);
      }
      if (method === 'DELETE') {
        return this._handleDelete(requestId, projectId);
      }
      return this._methodNotAllowed(requestId, ['GET', 'PATCH', 'DELETE']);
    }

    if (segments.length === 3) {
      const [, projectId, action] = segments;
      if (action !== 'archive' && action !== 'unarchive') {
        // Not a route this feature owns — let the core handler answer 404.
        return undefined;
      }
      if (method !== 'POST') {
        return this._methodNotAllowed(requestId, ['POST']);
      }
      return this._handleArchive(requestId, projectId, action === 'archive');
    }

    return undefined;
  }

  private async _handleGet(
    requestId: string,
    projectId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const project = await this._getProjectById(projectId);
    if (!project) {
      return projectNotFound(requestId);
    }
    return createSuccessResponse(requestId, 200, project);
  }

  private async _handleCreate(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body)) {
      return invalidInput(requestId, 'Request body must be a JSON object');
    }

    const rejected = firstRejectedProjectField(body);
    if (rejected) {
      return this._unsupportedField(requestId, rejected);
    }

    const projectFields = pickAllowedProjectFields(body);
    if (typeof projectFields.title !== 'string' || !projectFields.title.trim()) {
      return invalidInput(requestId, TITLE_ERROR);
    }

    const validation = validateWritableProjectFields(projectFields);
    if (!validation.ok) {
      return this._invalidFieldTypes(requestId, validation.errors);
    }

    // ProjectService.add() mints its own nanoid and merges DEFAULT_PROJECT,
    // so an `id` sent in the body cannot leak through (it is not in the
    // allowlist and is dropped by pickAllowedProjectFields).
    const projectId = this._projectService.add(projectFields);
    const createdProject = await this._getProjectById(projectId);
    return createSuccessResponse(
      requestId,
      201,
      createdProject || { id: projectId, ...projectFields },
    );
  }

  private async _handleUpdate(
    requestId: string,
    projectId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    if (!isRecord(body)) {
      return invalidInput(requestId, 'PATCH body must be a JSON object');
    }

    const rejected = firstRejectedProjectField(body);
    if (rejected) {
      return this._unsupportedField(requestId, rejected);
    }

    const project = await this._getProjectById(projectId);
    if (!project) {
      return projectNotFound(requestId);
    }

    const changes = pickAllowedProjectFields(body);
    if (Object.keys(changes).length === 0) {
      // Every field was unknown or none was sent: nothing would change, and a
      // 200 would be indistinguishable from a real update.
      return invalidInput(requestId, 'Request body has no writable project fields');
    }
    if (
      'title' in changes &&
      (typeof changes.title !== 'string' || !changes.title.trim())
    ) {
      return invalidInput(requestId, TITLE_ERROR);
    }

    const validation = validateWritableProjectFields(changes);
    if (!validation.ok) {
      return this._invalidFieldTypes(requestId, validation.errors);
    }

    this._projectService.update(projectId, changes);
    const updatedProject = await this._getProjectById(projectId);
    return createSuccessResponse(requestId, 200, updatedProject || project);
  }

  private async _handleDelete(
    requestId: string,
    projectId: string,
  ): Promise<LocalRestApiResponsePayload> {
    if (projectId === INBOX_PROJECT.id) {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        'The Inbox project cannot be deleted',
      );
    }

    const project = await this._getProjectById(projectId);
    if (!project) {
      return projectNotFound(requestId);
    }

    // ProjectService.remove() deletes the project's tasks with it (backlog and
    // subtasks included), exactly as the UI's own "Delete project" does. If the
    // deleted project is the one on screen, the active context falls back to
    // Today.
    await this._projectService.remove(project);
    return createSuccessResponse(requestId, 200, { id: projectId, deleted: true });
  }

  private async _handleArchive(
    requestId: string,
    projectId: string,
    isArchive: boolean,
  ): Promise<LocalRestApiResponsePayload> {
    // Refuse before the store lookup: the reducer ignores archiveProject for
    // the Inbox, so a 200 here would report a change that never happens.
    if (isArchive && projectId === INBOX_PROJECT.id) {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        'The Inbox project cannot be archived',
      );
    }

    const project = await this._getProjectById(projectId);
    if (!project) {
      return projectNotFound(requestId);
    }

    if (isArchive ? project.isArchived : !project.isArchived) {
      // Already in the requested state — idempotent no-op.
      return createSuccessResponse(requestId, 200, {
        id: projectId,
        archived: project.isArchived,
      });
    }

    // Dedicated persistent action, not a plain updateProject: mirrors the task
    // pattern so any future archive side effects fire from one place.
    this._store.dispatch(
      isArchive ? archiveProject({ id: projectId }) : unarchiveProject({ id: projectId }),
    );
    return createSuccessResponse(requestId, 200, { id: projectId, archived: isArchive });
  }

  /**
   * The id equality check rejects prototype-property names ('constructor',
   * 'toString', …) that entity-map lookups resolve to truthy non-projects.
   * Archived projects stay readable by id (GET/PATCH), they are just excluded
   * from the list endpoint and from being a task-move destination.
   */
  private async _getProjectById(projectId: string): Promise<Project | undefined> {
    const project = await firstValueFrom(this._projectService.getByIdOnce$(projectId));
    return project?.id === projectId ? project : undefined;
  }

  /**
   * The path exists but not for this verb. Distinct from the core handler's
   * 404 so a client can tell "wrong method" from "no such route".
   */
  private _methodNotAllowed(
    requestId: string,
    allowed: readonly string[],
  ): LocalRestApiResponsePayload {
    return createErrorResponse(
      requestId,
      405,
      'METHOD_NOT_ALLOWED',
      `Method not allowed; allowed: ${allowed.join(', ')}`,
    );
  }

  private _unsupportedField(
    requestId: string,
    field: string,
  ): LocalRestApiResponsePayload {
    return createErrorResponse(
      requestId,
      400,
      'UNSUPPORTED_FIELD',
      `${field} cannot be set via project REST API`,
    );
  }

  private _invalidFieldTypes(
    requestId: string,
    errors: FieldTypeError[],
  ): LocalRestApiResponsePayload {
    return invalidInput(
      requestId,
      'One or more project fields have an invalid type',
      errors,
    );
  }
}
