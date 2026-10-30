import { IValidation } from 'typia';
import { isRecord, parseLocalRestApiBody } from './local-rest-api-body';

describe('local-rest-api-body', () => {
  const KEYS: ReadonlySet<string> = new Set(['title', 'count']);
  const accept = (b: Record<string, unknown>): IValidation<Record<string, unknown>> => ({
    success: true,
    data: b,
  });
  const reject = (): IValidation<Record<string, unknown>> => ({
    success: false,
    data: undefined,
    errors: [{ path: '$input.count', expected: 'number', value: 'x' }],
  });

  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    for (const value of [null, undefined, [], 'x', 1]) {
      expect(isRecord(value)).toBe(false);
    }
  });

  it('returns the validated body', () => {
    const result = parseLocalRestApiBody('r', { title: 'a' }, KEYS, accept, 'thing');
    expect(result).toEqual({ ok: true, value: { title: 'a' } });
  });

  it('rejects a body that is not an object', () => {
    const result = parseLocalRestApiBody('r', ['title'], KEYS, accept, 'thing');
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.response.body).toEqual({
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Request body must be a JSON object',
        details: undefined,
      },
    });
  });

  it('rejects fields outside the allowed keys before validating', () => {
    const validate = jasmine.createSpy('validate').and.callFake(accept);
    const result = parseLocalRestApiBody(
      'r',
      { title: 'a', id: 'x' },
      KEYS,
      validate,
      't',
    );
    expect(validate).not.toHaveBeenCalled();
    expect(result.ok ? undefined : result.response).toEqual({
      requestId: 'r',
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'UNSUPPORTED_FIELD',
          message: 'Field(s) cannot be set through this endpoint: id',
          details: { fields: ['id'] },
        },
      },
    });
  });

  it('reports type errors with path and expected type', () => {
    const result = parseLocalRestApiBody('r', { count: 'x' }, KEYS, reject, 'thing');
    expect(result.ok ? undefined : result.response.body).toEqual({
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'One or more thing fields have an invalid type',
        details: [{ path: '$input.count', expected: 'number' }],
      },
    });
  });
});
