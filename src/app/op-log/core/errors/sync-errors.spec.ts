import type { IValidation } from 'typia';
import { OpLog } from '../../../core/log';
import {
  DataValidationFailedError,
  DecompressError,
  InvalidFilePrefixError,
  InvalidDataSPError,
  JsonParseError,
  ModelValidationError,
} from './sync-errors';

describe('sync errors', () => {
  beforeEach(() => {
    spyOn(OpLog, 'log').and.stub();
    spyOn(OpLog, 'err').and.stub();
  });

  // NOTE: InvalidDataSPError (and the other moved provider errors) no
  // longer log on construction — see PR 5a (docs/plans/2026-05-12-pr5-dropbox-slice.md).
  // Privacy guarantee for those classes is now "no log = no leak" and is
  // covered by packages/sync-providers/tests/errors.spec.ts. App-side
  // privacy responsibility shifts entirely to catch-site logging.
  it('does not log on construction for provider errors (privacy invariant after PR 5a)', () => {
    new InvalidDataSPError({
      responseName: 'sync-response',
      status: 400,
      payload: { title: 'secret task' },
    });

    expect((OpLog.log as jasmine.Spy).calls.count()).toBe(0);
  });

  it('stores InvalidFilePrefixError details on additionalLog without logging on construction', () => {
    const err = new InvalidFilePrefixError({
      expectedPrefix: 'pf_',
      endSeparator: '__',
      inputLength: 42,
    });

    expect((OpLog.log as jasmine.Spy).calls.count()).toBe(0);
    expect(err.additionalLog).toBeDefined();
  });

  it('does not log on construction for DecompressError', () => {
    // Privacy responsibility shifts to catch-site logging after PR 5a;
    // .message may still contain the inner error's text — callers must
    // not log .message directly via OP_LOG_SYNC_LOGGER (the SyncLogger
    // privacy contract bans raw user data; toSyncLogError sanitizes).
    new DecompressError(new Error('placeholder inner error'));

    expect((OpLog.log as jasmine.Spy).calls.count()).toBe(0);
  });

  it('does not log JSON parse data samples or raw original errors', () => {
    new JsonParseError(
      new SyntaxError('Unexpected token SECRET at position 6'),
      '{"a":"secret value"}',
    );

    const errText = JSON.stringify((OpLog.err as jasmine.Spy).calls.allArgs());
    expect(errText).toContain('JsonParseError');
    expect(errText).toContain('dataLength');
    expect(errText).not.toContain('SECRET');
    expect(errText).not.toContain('secret value');
  });

  it('logs model validation diagnostics without validation payloads', () => {
    const validationResult = {
      success: false,
      errors: [
        {
          path: '$input.title',
          expected: 'string',
          value: 'secret title',
        },
      ],
    } as unknown as IValidation<unknown>;

    new ModelValidationError({
      id: 'task-id-1',
      data: { title: 'secret title' },
      validationResult,
      e: new Error('secret validation failure'),
    });

    const logText = JSON.stringify((OpLog.log as jasmine.Spy).calls.allArgs());
    expect(logText).toContain('ModelValidationError');
    expect(logText).toContain('task-id-1');
    expect(logText).toContain('validationErrorCount');
    expect(logText).not.toContain('secret title');
    expect(logText).not.toContain('secret validation failure');
  });

  it('logs data validation diagnostics without validation payloads', () => {
    const validationResult = {
      success: false,
      errors: [
        {
          path: '$input.notes',
          expected: 'string',
          value: 'secret note text',
        },
      ],
    } as unknown as IValidation<unknown>;

    new DataValidationFailedError(validationResult);

    const logText = JSON.stringify((OpLog.log as jasmine.Spy).calls.allArgs());
    expect(logText).toContain('DataValidationFailedError');
    expect(logText).toContain('validationErrorCount');
    expect(logText).toContain('$input.notes');
    expect(logText).not.toContain('secret note text');
  });
});
