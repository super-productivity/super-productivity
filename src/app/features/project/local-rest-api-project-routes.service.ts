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
import { INBOX_PROJECT } from './project.const';
import { Project } from './project.model';
import { ProjectService } from './project.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { selectAllTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';

interface UpdateProjectFields {
  title?: string;
  icon?: string | null;
}

interface CreateProjectFields extends UpdateProjectFields {
  title: string;
}

const WRITABLE_KEYS: ReadonlySet<string> = new Set(['title', 'icon']);

/** What `DELETE /projects/:id` would take with it; any non-zero count blocks it. */
interface ProjectContents {
  taskCount: number;
  backlogTaskCount: number;
  archivedTaskCount: number;
  noteCount: number;
  repeatCfgCount: number;
  timeTrackingDayCount: number;
}

const CONTENT_LABELS: Record<keyof ProjectContents, string> = {
  taskCount: 'tasks',
  backlogTaskCount: 'backlog tasks',
  archivedTaskCount: 'archived tasks',
  noteCount: 'notes',
  repeatCfgCount: 'repeat configs',
  timeTrackingDayCount: 'time-tracking data',
};

/**
 * Local REST API write routes under `/projects`. `GET /projects` is served by
 * the core handler before feature routes run, so this only handles POST,
 * PATCH and DELETE. Like `GET /projects`, it only sees unarchived projects.
 */
@Injectable()
export class LocalRestApiProjectRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _projectService = inject(ProjectService);
  private readonly _store = inject(Store);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _timeTrackingService = inject(TimeTrackingService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'projects') {
      return undefined;
    }

    if (segments.length === 1 && method === 'POST') {
      return this._handleCreate(requestId, body);
    }

    if (segments.length === 2) {
      const projectId = segments[1];
      if (method === 'PATCH') {
        return this._handleUpdate(requestId, projectId, body);
      }
      if (method === 'DELETE') {
        return this._handleDelete(requestId, projectId);
      }
    }

    return undefined;
  }

  private async _handleCreate(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseBody(requestId, body, (b) =>
      typia.validate<CreateProjectFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const { title, icon } = parsed.value;

    const projectId = this._projectService.add({
      title,
      ...(icon !== undefined ? { icon } : {}),
    });

    return createSuccessResponse(requestId, 201, await this._getProject(projectId));
  }

  private async _handleUpdate(
    requestId: string,
    projectId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseBody(requestId, body, (b) =>
      typia.validate<UpdateProjectFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const project = await this._getProject(projectId);
    if (!project) {
      return this._projectNotFound(requestId);
    }

    if (Object.keys(parsed.value).length > 0) {
      // The caller gets the result in the response; the app's "Project
      // updated" snack would only interrupt whoever is using it.
      this._projectService.update(projectId, parsed.value, true);
    }

    return createSuccessResponse(requestId, 200, await this._getProject(projectId));
  }

  /**
   * Only deletes a project that holds nothing. The app's "Delete project"
   * also deletes its tasks, backlog, archived tasks, notes, repeat configs and
   * time-tracking data, on every synced device and beyond undo, after a
   * confirm dialog a REST caller never sees. So any of those refuses the
   * delete with 409 PROJECT_NOT_EMPTY and the counts. Sections do not block:
   * with no tasks left they are empty headings, and they go with the project.
   */
  private async _handleDelete(
    requestId: string,
    projectId: string,
  ): Promise<LocalRestApiResponsePayload> {
    // The fallback target for tasks that belong nowhere; the UI does not
    // offer deleting it either.
    if (projectId === INBOX_PROJECT.id) {
      return createErrorResponse(
        requestId,
        400,
        'UNSUPPORTED_FIELD',
        'The Inbox project cannot be deleted',
      );
    }

    const project = await this._getProject(projectId);
    if (!project) {
      return this._projectNotFound(requestId);
    }

    const contents = await this._getContents(project);
    const blockers = (Object.keys(contents) as (keyof ProjectContents)[]).filter(
      (key) => contents[key] > 0,
    );
    if (blockers.length > 0) {
      const what = blockers.map((key) => CONTENT_LABELS[key]).join(', ');
      // Nothing in this API removes time-tracking data, so say where it can go.
      const hint = contents.timeTrackingDayCount
        ? '; time-tracking data can only be removed by deleting the project in the app'
        : '';
      return createErrorResponse(
        requestId,
        409,
        'PROJECT_NOT_EMPTY',
        `Project still has ${what}; remove them before deleting the project${hint}`,
        contents,
      );
    }

    await this._projectService.remove(project);

    return createSuccessResponse(requestId, 200, { deleted: true, id: projectId });
  }

  /**
   * Rejects a non-object body and keys other than title and icon, then
   * type-checks the rest. A title, where given, is trimmed and must not end up
   * empty.
   */
  private _parseBody<T extends UpdateProjectFields>(
    requestId: string,
    body: unknown,
    validate: (body: Record<string, unknown>) => IValidation<T>,
  ): LocalRestApiResult<T> {
    const parsed = parseLocalRestApiBody(
      requestId,
      body,
      WRITABLE_KEYS,
      validate,
      'project',
    );
    if (!parsed.ok || parsed.value.title === undefined) {
      return parsed;
    }
    const title = parsed.value.title.trim();
    if (!title) {
      return {
        ok: false,
        response: this._invalid(requestId, 'title must be a non-empty string'),
      };
    }
    return { ok: true, value: { ...parsed.value, title } };
  }

  /**
   * Counts what ProjectService.remove() would delete with the project. Loads
   * the whole task archive; acceptable for a delete.
   */
  private async _getContents(project: Project): Promise<ProjectContents> {
    const [archive, repeatCfgs, timeTracking] = await Promise.all([
      this._taskArchiveService.load(),
      firstValueFrom(this._store.select(selectAllTaskRepeatCfgs)),
      firstValueFrom(this._timeTrackingService.state$),
    ]);
    const archivedTaskCount = (archive.ids as string[]).filter(
      (id) => archive.entities[id]?.projectId === project.id,
    ).length;
    const projectTimeTracking = Object.prototype.hasOwnProperty.call(
      timeTracking.project,
      project.id,
    )
      ? timeTracking.project[project.id]
      : undefined;
    return {
      taskCount: project.taskIds.length,
      backlogTaskCount: project.backlogTaskIds.length,
      archivedTaskCount,
      noteCount: project.noteIds.length,
      repeatCfgCount: repeatCfgs.filter((cfg) => cfg.projectId === project.id).length,
      timeTrackingDayCount: Object.keys(projectTimeTracking ?? {}).length,
    };
  }

  /**
   * By id equality over the unarchived list: the entity map lookup would
   * resolve ids like `__proto__` to prototype members.
   */
  private async _getProject(projectId: string): Promise<Project | undefined> {
    const projects = await firstValueFrom(this._projectService.list$);
    return projects.find((project) => project.id === projectId);
  }

  private _projectNotFound(requestId: string): LocalRestApiResponsePayload {
    return createErrorResponse(requestId, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  private _invalid(
    requestId: string,
    message: string,
    details?: unknown,
  ): LocalRestApiResponsePayload {
    return createErrorResponse(requestId, 400, 'INVALID_INPUT', message, details);
  }
}
