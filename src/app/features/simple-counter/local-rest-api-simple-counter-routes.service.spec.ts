/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { LocalRestApiSimpleCounterRoutesService } from './local-rest-api-simple-counter-routes.service';
import { SimpleCounterService } from './simple-counter.service';
import { SimpleCounter, SimpleCounterType } from './simple-counter.model';
import { DateService } from '../../core/date/date.service';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiSimpleCounterRoutesService', () => {
  const TODAY = '2026-10-04';

  let service: LocalRestApiSimpleCounterRoutesService;
  let counterServiceMock: jasmine.SpyObj<SimpleCounterService>;
  let counters$: BehaviorSubject<SimpleCounter[]>;

  const createCounter = (
    id: string,
    overrides: Partial<SimpleCounter> = {},
  ): SimpleCounter => ({
    id,
    title: `Counter ${id}`,
    isEnabled: true,
    icon: null,
    type: SimpleCounterType.ClickCounter,
    countOnDay: {},
    isOn: false,
    ...overrides,
  });

  const setDay = (id: string, date: string, newVal: number): void => {
    counters$.next(
      counters$.value.map((c) =>
        c.id === id ? { ...c, countOnDay: { ...c.countOnDay, [date]: newVal } } : c,
      ),
    );
  };

  const request = (
    method: string,
    path: string,
    body?: unknown,
  ): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method,
    path,
    query: {},
    body,
  });

  const handle = async (
    req: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> => {
    const response = await service.handle(req);
    if (!response) {
      throw new Error(`Route not handled: ${req.method} ${req.path}`);
    }
    return response;
  };

  const errorCode = (response: LocalRestApiResponsePayload): string | undefined =>
    response.body.ok ? undefined : response.body.error.code;

  const data = <T>(response: LocalRestApiResponsePayload): T => {
    if (!response.body.ok) {
      throw new Error(`Expected success, got ${response.body.error.code}`);
    }
    return response.body.data as T;
  };

  const expectNoDispatch = (): void => {
    expect(counterServiceMock.setCounterForDate).not.toHaveBeenCalled();
    expect(counterServiceMock.increaseCounterToday).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    counters$ = new BehaviorSubject<SimpleCounter[]>([
      createCounter('water', { countOnDay: { [TODAY]: 3, '2026-10-03': 8 } }),
      createCounter('focus', {
        type: SimpleCounterType.StopWatch,
        countOnDay: { [TODAY]: 600000 },
      }),
      createCounter('stretch', {
        type: SimpleCounterType.RepeatedCountdownReminder,
        isEnabled: false,
      }),
    ]);

    counterServiceMock = jasmine.createSpyObj<SimpleCounterService>(
      'SimpleCounterService',
      ['setCounterForDate', 'increaseCounterToday'],
      { simpleCounters$: counters$ },
    );
    counterServiceMock.setCounterForDate.and.callFake(setDay);
    counterServiceMock.increaseCounterToday.and.callFake(async (id, increaseBy) => {
      const counter = counters$.value.find((c) => c.id === id);
      setDay(id, TODAY, (counter?.countOnDay[TODAY] || 0) + increaseBy);
    });

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiSimpleCounterRoutesService,
        { provide: SimpleCounterService, useValue: counterServiceMock },
        { provide: DateService, useValue: { todayStr: (): string => TODAY } },
      ],
    });
    service = TestBed.inject(LocalRestApiSimpleCounterRoutesService);
  });

  describe('routing', () => {
    it('does not handle routes it does not own', async () => {
      expect(await service.handle(request('GET', '/tasks'))).toBeUndefined();
      expect(await service.handle(request('POST', '/simple-counters'))).toBeUndefined();
      expect(
        await service.handle(request('PATCH', '/simple-counters/water')),
      ).toBeUndefined();
      expect(
        await service.handle(request('POST', '/simple-counters/water/value')),
      ).toBeUndefined();
      expect(
        await service.handle(request('GET', '/simple-counters/water/increment')),
      ).toBeUndefined();
    });
  });

  describe('GET', () => {
    it('lists all counters, disabled ones included', async () => {
      const response = await handle(request('GET', '/simple-counters'));

      expect(response.status).toBe(200);
      expect(data<SimpleCounter[]>(response).map((c) => c.id)).toEqual([
        'water',
        'focus',
        'stretch',
      ]);
    });

    it('returns a counter with its values per day', async () => {
      const response = await handle(request('GET', '/simple-counters/water'));

      expect(response.status).toBe(200);
      expect(data<SimpleCounter>(response).countOnDay).toEqual({
        [TODAY]: 3,
        '2026-10-03': 8,
      });
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__', 'constructor']) {
        const response = await handle(request('GET', `/simple-counters/${id}`));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('SIMPLE_COUNTER_NOT_FOUND');
      }
    });
  });

  describe('PUT /simple-counters/:id/value', () => {
    it("sets today's value by default", async () => {
      const response = await handle(
        request('PUT', '/simple-counters/water/value', { value: 5 }),
      );

      expect(response.status).toBe(200);
      expect(counterServiceMock.setCounterForDate).toHaveBeenCalledOnceWith(
        'water',
        TODAY,
        5,
      );
      expect(data<SimpleCounter>(response).countOnDay[TODAY]).toBe(5);
    });

    it('sets the value of another day', async () => {
      await handle(
        request('PUT', '/simple-counters/water/value', { date: '2026-09-30', value: 2 }),
      );

      expect(counterServiceMock.setCounterForDate).toHaveBeenCalledOnceWith(
        'water',
        '2026-09-30',
        2,
      );
    });

    it('sets a stopwatch in milliseconds', async () => {
      await handle(request('PUT', '/simple-counters/focus/value', { value: 1500000 }));

      expect(counterServiceMock.setCounterForDate).toHaveBeenCalledOnceWith(
        'focus',
        TODAY,
        1500000,
      );
    });

    it('does not dispatch when the value does not change', async () => {
      for (const body of [
        { value: 3 },
        { date: '2026-10-03', value: 8 },
        { date: '2026-09-01', value: 0 },
      ]) {
        const response = await handle(
          request('PUT', '/simple-counters/water/value', body),
        );
        expect(response.status).toBe(200);
      }
      expectNoDispatch();
    });

    it('rejects invalid values and dates', async () => {
      for (const body of [
        { value: -1 },
        { value: 1.5 },
        { value: 2 ** 53 },
        { value: '3' },
        {},
        { value: 1, date: '2026-02-30' },
        { value: 1, date: '__proto__' },
        { value: 1, date: 20261004 },
        undefined,
        null,
        [],
      ]) {
        const response = await handle(
          request('PUT', '/simple-counters/water/value', body),
        );
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('rejects unsupported fields', async () => {
      const response = await handle(
        request('PUT', '/simple-counters/water/value', { value: 1, countOnDay: {} }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expect(response.body.ok ? undefined : response.body.error.details).toEqual({
        fields: ['countOnDay'],
      });
      expectNoDispatch();
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__']) {
        const response = await handle(
          request('PUT', `/simple-counters/${id}/value`, { value: 1 }),
        );
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('SIMPLE_COUNTER_NOT_FOUND');
      }
      expectNoDispatch();
    });
  });

  describe('POST /simple-counters/:id/increment', () => {
    it('counts up today by 1 without a body, like the counter button', async () => {
      const response = await handle(request('POST', '/simple-counters/water/increment'));

      expect(response.status).toBe(200);
      expect(counterServiceMock.increaseCounterToday).toHaveBeenCalledOnceWith(
        'water',
        1,
      );
      expect(data<SimpleCounter>(response).countOnDay[TODAY]).toBe(4);
    });

    it('counts up by a given amount', async () => {
      await handle(request('POST', '/simple-counters/stretch/increment', { by: 3 }));

      expect(counterServiceMock.increaseCounterToday).toHaveBeenCalledOnceWith(
        'stretch',
        3,
      );
    });

    it('rejects stopwatches', async () => {
      const response = await handle(request('POST', '/simple-counters/focus/increment'));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('accepts the largest safe total and rejects overflow without dispatching', async () => {
      const accepted = await handle(
        request('POST', '/simple-counters/water/increment', {
          by: Number.MAX_SAFE_INTEGER - 3,
        }),
      );
      expect(accepted.status).toBe(200);
      expect(data<SimpleCounter>(accepted).countOnDay[TODAY]).toBe(
        Number.MAX_SAFE_INTEGER,
      );
      counterServiceMock.increaseCounterToday.calls.reset();
      counterServiceMock.setCounterForDate.calls.reset();

      const rejected = await handle(request('POST', '/simple-counters/water/increment'));
      expect(rejected.status).toBe(400);
      expect(errorCode(rejected)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('rejects invalid amounts and bodies', async () => {
      for (const body of [{ by: 0 }, { by: -1 }, { by: 1.5 }, { by: '1' }, null, []]) {
        const response = await handle(
          request('POST', '/simple-counters/water/increment', body),
        );
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      const unsupported = await handle(
        request('POST', '/simple-counters/water/increment', { by: 1, date: TODAY }),
      );
      expect(errorCode(unsupported)).toBe('UNSUPPORTED_FIELD');
      expectNoDispatch();
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__']) {
        const response = await handle(
          request('POST', `/simple-counters/${id}/increment`),
        );
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('SIMPLE_COUNTER_NOT_FOUND');
      }
      expectNoDispatch();
    });
  });
});
