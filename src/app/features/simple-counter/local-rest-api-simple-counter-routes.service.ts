import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import typia, { IValidation } from 'typia';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  LocalRestApiResult,
  parseLocalRestApiBody,
} from '../../core/electron/local-rest-api-body';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { DateService } from '../../core/date/date.service';
import { isValidDBDateStr } from '../../util/get-db-date-str';
import { SimpleCounter, SimpleCounterType } from './simple-counter.model';
import { SimpleCounterService } from './simple-counter.service';

interface SetValueFields {
  date?: string;
  value: number;
}

interface IncrementFields {
  by?: number;
}

const SET_VALUE_KEYS: ReadonlySet<string> = new Set(['date', 'value']);
// Same floor as a repeat's startDate: earlier years break the counter's
// day-based charts and cannot be removed again through the app.
const MIN_DATE = '1000-01-01';
const INCREMENT_KEYS: ReadonlySet<string> = new Set(['by']);

/**
 * Local REST API routes under `/simple-counters`: read the counters and
 * habits, set the value of a day, and count up today.
 */
@Injectable()
export class LocalRestApiSimpleCounterRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _simpleCounterService = inject(SimpleCounterService);
  private readonly _dateService = inject(DateService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'simple-counters') {
      return undefined;
    }

    if (segments.length === 1 && method === 'GET') {
      return createSuccessResponse(requestId, 200, await this._getCounters());
    }

    if (segments.length === 2 && method === 'GET') {
      const counter = await this._getCounter(segments[1]);
      if (!counter) {
        return this._counterNotFound(requestId);
      }
      return createSuccessResponse(requestId, 200, counter);
    }

    if (segments.length === 3) {
      const counterId = segments[1];
      if (segments[2] === 'value' && method === 'PUT') {
        return this._handleSetValue(requestId, counterId, body);
      }
      if (segments[2] === 'increment' && method === 'POST') {
        return this._handleIncrement(requestId, counterId, body);
      }
    }

    return undefined;
  }

  private async _handleSetValue(
    requestId: string,
    counterId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseBody(requestId, body, SET_VALUE_KEYS, (b) =>
      typia.validate<SetValueFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const { value } = parsed.value;
    const date = parsed.value.date ?? this._dateService.todayStr();

    if (!Number.isSafeInteger(value) || value < 0) {
      return this._invalid(requestId, 'value must be a non-negative integer');
    }
    if (!isValidDBDateStr(date)) {
      return this._invalid(requestId, 'date must be a valid YYYY-MM-DD date');
    }
    if (date < MIN_DATE) {
      return this._invalid(requestId, `date must not be before ${MIN_DATE}`);
    }
    if (date > this._dateService.todayStr()) {
      return this._invalid(requestId, 'date must not be after today');
    }

    const counter = await this._getCounter(counterId);
    if (!counter) {
      return this._counterNotFound(requestId);
    }

    // Like saving the counter's edit dialog or clicking a day in the habit
    // tracker: one absolute value for the day, only when it changes.
    if ((counter.countOnDay?.[date] || 0) !== value) {
      this._simpleCounterService.setCounterForDate(counterId, date, value);
    }

    return createSuccessResponse(requestId, 200, await this._getCounter(counterId));
  }

  private async _handleIncrement(
    requestId: string,
    counterId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    // An empty body counts up by 1.
    const parsed = this._parseBody(
      requestId,
      body === undefined ? {} : body,
      INCREMENT_KEYS,
      (b) => typia.validate<IncrementFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const by = parsed.value.by ?? 1;
    if (!Number.isSafeInteger(by) || by < 1) {
      return this._invalid(requestId, 'by must be a positive integer');
    }

    const counter = await this._getCounter(counterId);
    if (!counter) {
      return this._counterNotFound(requestId);
    }
    // A stopwatch counts milliseconds while it runs; the app has no "+1" for
    // it. Its value is set with PUT /simple-counters/:id/value.
    if (counter.type === SimpleCounterType.StopWatch) {
      return this._invalid(
        requestId,
        'A stopwatch cannot be incremented; set its value with PUT /simple-counters/:id/value',
      );
    }

    const today = this._dateService.todayStr();
    if (!Number.isSafeInteger((counter.countOnDay?.[today] ?? 0) + by)) {
      return this._invalid(
        requestId,
        'The resulting counter value must be a safe integer',
      );
    }

    // Like the counter button: today's value plus `by`, stored as an absolute
    // value so the op is the same on every client.
    await this._simpleCounterService.increaseCounterToday(counterId, by);

    return createSuccessResponse(requestId, 200, await this._getCounter(counterId));
  }

  private _parseBody<T>(
    requestId: string,
    body: unknown,
    allowedKeys: ReadonlySet<string>,
    validate: (body: Record<string, unknown>) => IValidation<T>,
  ): LocalRestApiResult<T> {
    return parseLocalRestApiBody(
      requestId,
      body,
      allowedKeys,
      validate,
      'simple counter',
    );
  }

  private async _getCounters(): Promise<SimpleCounter[]> {
    return firstValueFrom(this._simpleCounterService.simpleCounters$);
  }

  /**
   * By id equality over the list: the entity map lookups would resolve ids
   * like `__proto__` to prototype members.
   */
  private async _getCounter(counterId: string): Promise<SimpleCounter | undefined> {
    const counters = await this._getCounters();
    return counters.find((counter) => counter.id === counterId);
  }

  private _counterNotFound(requestId: string): LocalRestApiResponsePayload {
    return createErrorResponse(
      requestId,
      404,
      'SIMPLE_COUNTER_NOT_FOUND',
      'Simple counter not found',
    );
  }

  private _invalid(
    requestId: string,
    message: string,
    details?: unknown,
  ): LocalRestApiResponsePayload {
    return createErrorResponse(requestId, 400, 'INVALID_INPUT', message, details);
  }
}
