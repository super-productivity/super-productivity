import { firstValueFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import typia from 'typia';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { ProjectService } from '../../features/project/project.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { Project } from '../../features/project/project.model';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import {
  archiveProject,
  unarchiveProject,
} from '../../features/project/store/project.actions';
import { createErrorResponse, createSuccessResponse } from './local-rest-api-response';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

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

/**
 * Dependencies of the project REST routes. The handler service keeps under
 * the service size cap by delegating these routes here; the project service
 * and store are passed in rather than injected, so the delegated helpers stay
 * pure functions of their arguments.
 */
export interface LocalRestApiProjectDeps {
  projectService: ProjectService;
  store: Store;
}

const invalidInput = (
  requestId: string,
  message: string,
  details?: unknown,
): LocalRestApiResponsePayload =>
  createErrorResponse(requestId, 400, 'INVALID_INPUT', message, details);

const projectNotFound = (requestId: string): LocalRestApiResponsePayload =>
  createErrorResponse(requestId, 404, 'PROJECT_NOT_FOUND', 'Project not found');

/**
 * The id equality check rejects prototype-property names ('constructor',
 * 'toString', …) that entity-map lookups resolve to truthy non-projects.
 * Archived projects stay readable by id (GET/PATCH), they are just excluded
 * from the list endpoint and from being a task-move destination.
 */
const getProjectById = async (
  projectService: ProjectService,
  projectId: string,
): Promise<Project | undefined> => {
  const project = await firstValueFrom(projectService.getByIdOnce$(projectId));
  return project?.id === projectId ? project : undefined;
};

const TITLE_ERROR = 'Project title must be a non-empty string';

export const handleProjectRoutes = async (
  deps: LocalRestApiProjectDeps,
  payload: LocalRestApiRequestPayload,
  segments: string[],
): Promise<LocalRestApiResponsePayload> => {
  const { method, requestId, body } = payload;
  const projectId = segments[1];

  if (segments.length === 2 && method === 'GET') {
    const project = await getProjectById(deps.projectService, projectId);
    if (!project) {
      return projectNotFound(requestId);
    }
    return createSuccessResponse(requestId, 200, project);
  }

  if (segments.length === 2 && method === 'DELETE') {
    return handleDeleteProject(deps, requestId, projectId);
  }

  if (segments.length === 2 && method === 'PATCH') {
    if (!isRecord(body)) {
      return invalidInput(requestId, 'PATCH body must be a JSON object');
    }

    const rejected = firstRejectedProjectField(body);
    if (rejected) {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        `${rejected} cannot be set via project REST API`,
      );
    }

    const project = await getProjectById(deps.projectService, projectId);
    if (!project) {
      return projectNotFound(requestId);
    }

    const changes = pickAllowedProjectFields(body);
    if (
      'title' in changes &&
      (typeof changes.title !== 'string' || !changes.title.trim())
    ) {
      return invalidInput(requestId, TITLE_ERROR);
    }

    const validation = validateWritableProjectFields(changes);
    if (!validation.ok) {
      return invalidInput(
        requestId,
        'One or more project fields have an invalid type',
        validation.errors,
      );
    }

    deps.projectService.update(projectId, changes);
    const updatedProject = await getProjectById(deps.projectService, projectId);
    return createSuccessResponse(requestId, 200, updatedProject || project);
  }

  if (segments.length === 3 && segments[2] === 'archive' && method === 'POST') {
    return handleArchiveProject(deps, requestId, projectId, true);
  }

  if (segments.length === 3 && segments[2] === 'unarchive' && method === 'POST') {
    return handleArchiveProject(deps, requestId, projectId, false);
  }

  return createErrorResponse(requestId, 404, 'NOT_FOUND', 'Route not found');
};

const handleArchiveProject = async (
  deps: LocalRestApiProjectDeps,
  requestId: string,
  projectId: string,
  isArchive: boolean,
): Promise<LocalRestApiResponsePayload> => {
  const project = await getProjectById(deps.projectService, projectId);
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
  deps.store.dispatch(
    isArchive ? archiveProject({ id: projectId }) : unarchiveProject({ id: projectId }),
  );
  return createSuccessResponse(requestId, 200, { id: projectId, archived: isArchive });
};

const INBOX_PROJECT_ID = 'INBOX_PROJECT';

const handleDeleteProject = async (
  deps: LocalRestApiProjectDeps,
  requestId: string,
  projectId: string,
): Promise<LocalRestApiResponsePayload> => {
  if (projectId === INBOX_PROJECT_ID) {
    return createErrorResponse(
      requestId,
      400,
      'UNSUPPORTED_FIELD',
      'The Inbox project cannot be deleted',
    );
  }

  const project = await getProjectById(deps.projectService, projectId);
  if (!project) {
    return projectNotFound(requestId);
  }

  // ProjectService.remove() deletes the project's tasks with it (backlog and
  // subtasks included), exactly as the UI's own "Delete project" does. If the
  // deleted project is the one on screen, the active context falls back to
  // Today.
  await deps.projectService.remove(project);
  return createSuccessResponse(requestId, 200, { id: projectId, deleted: true });
};

export const handleCreateProject = async (
  deps: LocalRestApiProjectDeps,
  payload: LocalRestApiRequestPayload,
): Promise<LocalRestApiResponsePayload> => {
  const { requestId, body } = payload;

  if (!isRecord(body)) {
    return invalidInput(requestId, 'Request body must be a JSON object');
  }

  const rejected = firstRejectedProjectField(body);
  if (rejected) {
    return createErrorResponse(
      requestId,
      400,
      'UNSUPPORTED_FIELD',
      `${rejected} cannot be set via project REST API`,
    );
  }

  const projectFields = pickAllowedProjectFields(body);
  if (typeof projectFields.title !== 'string' || !projectFields.title.trim()) {
    return invalidInput(requestId, TITLE_ERROR);
  }

  const validation = validateWritableProjectFields(projectFields);
  if (!validation.ok) {
    return invalidInput(
      requestId,
      'One or more project fields have an invalid type',
      validation.errors,
    );
  }

  // ProjectService.add() mints its own nanoid and merges DEFAULT_PROJECT,
  // so an `id` sent in the body cannot leak through (it is not in the
  // allowlist and is dropped by pickAllowedProjectFields).
  const projectId = deps.projectService.add(projectFields);
  const createdProject = await getProjectById(deps.projectService, projectId);
  return createSuccessResponse(
    requestId,
    201,
    createdProject || { id: projectId, ...projectFields },
  );
};
