import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { TaskRepeatCfgService } from './task-repeat-cfg.service';
import {
  TaskRepeatCfgWriteResult,
  TaskRepeatCfgWriteService,
} from './task-repeat-cfg-write.service';

const getQueryParam = (
  query: Record<string, string | string[]>,
  key: string,
): string | undefined => {
  const value = query[key];
  return Array.isArray(value) ? value[0] : value;
};

/** Local REST API routes under `/task-repeat-cfgs`. */
@Injectable()
export class LocalRestApiTaskRepeatCfgRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _writeService = inject(TaskRepeatCfgWriteService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, query, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'task-repeat-cfgs') {
      return undefined;
    }

    if (segments.length === 1) {
      if (method === 'GET') {
        return this._handleList(requestId, query);
      }
      if (method === 'POST') {
        return this._handleCreate(requestId, body);
      }
      return undefined;
    }

    if (segments.length === 2) {
      const cfgId = segments[1];
      if (method === 'GET') {
        return this._handleGet(requestId, cfgId);
      }
      if (method === 'PATCH') {
        return this._handleUpdate(requestId, cfgId, body);
      }
      if (method === 'DELETE') {
        return this._handleDelete(requestId, cfgId);
      }
    }

    return undefined;
  }

  private async _handleList(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const projectId = getQueryParam(query, 'projectId');

    let cfgs = await firstValueFrom(this._taskRepeatCfgService.taskRepeatCfgs$);

    if (projectId) {
      cfgs = cfgs.filter((cfg) => cfg.projectId === projectId);
    }

    return createSuccessResponse(requestId, 200, cfgs);
  }

  private async _handleGet(
    requestId: string,
    cfgId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const cfg = await this._writeService.getCfg(cfgId);
    if (!cfg) {
      return this._cfgNotFound(requestId);
    }
    return createSuccessResponse(requestId, 200, cfg);
  }

  private async _handleCreate(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    return this._toResponse(requestId, 201, await this._writeService.create(body));
  }

  private async _handleUpdate(
    requestId: string,
    cfgId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    return this._toResponse(requestId, 200, await this._writeService.update(cfgId, body));
  }

  private async _handleDelete(
    requestId: string,
    cfgId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const cfg = await this._writeService.getCfg(cfgId);
    if (!cfg) {
      return this._cfgNotFound(requestId);
    }

    // Also unlinks the config from its tasks, active and archived.
    this._taskRepeatCfgService.deleteTaskRepeatCfg(cfgId);

    return createSuccessResponse(requestId, 200, { deleted: true, id: cfgId });
  }

  private _toResponse(
    requestId: string,
    successStatus: number,
    result: TaskRepeatCfgWriteResult,
  ): LocalRestApiResponsePayload {
    if (result.ok) {
      return createSuccessResponse(requestId, successStatus, result.value);
    }
    const { code, message, details } = result.error;
    const status =
      code === 'TASK_NOT_FOUND' || code === 'REPEAT_CFG_NOT_FOUND' ? 404 : 400;
    return createErrorResponse(requestId, status, code, message, details);
  }

  private _cfgNotFound(requestId: string): LocalRestApiResponsePayload {
    return createErrorResponse(
      requestId,
      404,
      'REPEAT_CFG_NOT_FOUND',
      'Repeat config not found',
    );
  }
}
