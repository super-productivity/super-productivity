import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import { createSuccessResponse } from '../../core/electron/local-rest-api-response';
import {
  selectCurrentCycle,
  selectIsBreakTimeUp,
  selectIsInOvertime,
  selectIsLongBreak,
  selectIsRunning,
  selectIsSessionCompleted,
  selectMode,
  selectTimeRemaining,
  selectTimer,
} from './store/focus-mode.selectors';

/** Local REST API route `GET /focus`. */
@Injectable()
export class LocalRestApiFocusRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _store = inject(Store);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    if (request.method !== 'GET' || request.path !== '/focus') {
      return undefined;
    }
    return this._handleGetFocus(request.requestId);
  }

  private async _handleGetFocus(requestId: string): Promise<LocalRestApiResponsePayload> {
    const state = await firstValueFrom(this._store);
    const timer = selectTimer(state);
    const mode = selectMode(state);
    const cycle = selectCurrentCycle(state);
    const isRunning = selectIsRunning(state);
    const isBreakTimeUp = selectIsBreakTimeUp(state);
    const isLongBreak = selectIsLongBreak(state);
    const remainingMs = selectTimeRemaining(state);
    const isSessionDone = selectIsSessionCompleted(state);
    const isOvertime = selectIsInOvertime(state);

    return createSuccessResponse(requestId, 200, {
      mode,
      cycle,
      isSessionDone,
      timer:
        timer.purpose === null
          ? null
          : {
              purpose: timer.purpose,
              status: isRunning ? 'running' : isBreakTimeUp ? 'done' : 'paused',
              isOvertime,
              isLongBreak,
              elapsedMs: timer.elapsed,
              remainingMs,
              durationMs: timer.duration,
            },
    });
  }
}
