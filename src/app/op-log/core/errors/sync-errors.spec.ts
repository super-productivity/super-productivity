import type { IValidation } from 'typia';
import { OpLog } from '../../../core/log';
import {
  DataValidationFailedError,
  DecompressError,
  InvalidFilePrefixError,
  InvalidDataSPError,
  JsonParseError,
  ModelValidationError,
  UnsupportedMultiEntityConflictError,
} from './sync-errors';
import { ActionType } from '../action-types.enum';

describe('sync errors', () => {
  beforeEach(() => {
    spyOn(OpLog, 'log').and.stub();
    spyOn(OpLog, 'err').and.stub();
  });

  // NOTE: InvalidDataSPError (and the other moved provider errors) no
  // longer log on construction (they were moved into @sp/sync-providers).
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
      prefixAt: -1,
      headShape: 'base64',
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

  it('does not log on construction for JsonParseError (privacy invariant)', () => {
    new JsonParseError(new SyntaxError('Unexpected token SECRET at position 6'));

    expect((OpLog.err as jasmine.Spy).calls.count()).toBe(0);
  });

  it('strips typia error values from ModelValidationError.additionalLog (privacy invariant)', () => {
    // additionalLog renders into the global error alert and the prefilled
    // GitHub issue body — the offending `value` (task title, note body) must
    // never survive into it; path + expected locate the failing field.
    const validationResult = {
      success: false,
      errors: [{ path: '$input.title', expected: 'string', value: 'secret title' }],
    } as unknown as IValidation<unknown>;

    const err = new ModelValidationError({
      id: 'task-id-1',
      data: { title: 'secret title' },
      validationResult,
    });

    expect(err.additionalLog).toBeDefined();
    expect(err.additionalLog).not.toContain('secret title');
    expect(err.additionalLog).toContain('$input.title');
    expect(err.additionalLog).toContain('string');
  });

  it('strips typia error values from DataValidationFailedError.additionalLog (privacy invariant)', () => {
    const validationResult = {
      success: false,
      errors: [{ path: '$input.notes', expected: 'string', value: 'secret note text' }],
    } as unknown as IValidation<unknown>;

    const err = new DataValidationFailedError(validationResult);

    expect(err.additionalLog).toBeDefined();
    expect(err.additionalLog).not.toContain('secret note text');
    expect(err.additionalLog).toContain('$input.notes');
  });

  it('does not log on construction for ModelValidationError (privacy invariant)', () => {
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

    expect((OpLog.log as jasmine.Spy).calls.count()).toBe(0);
  });

  it('does not log on construction for DataValidationFailedError (privacy invariant)', () => {
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

    expect((OpLog.log as jasmine.Spy).calls.count()).toBe(0);
  });

  it('builds a bounded unsupported multi-entity conflict breadcrumb', () => {
    const err = new UnsupportedMultiEntityConflictError(
      'local',
      ActionType.TASK_SHARED_UPDATE_MULTIPLE,
      2,
    );

    expect(err.name).toBe('UnsupportedMultiEntityConflictError');
    expect(err.message).toBe(
      'SYNC_MULTI_ENTITY_UNSUPPORTED side=local ' +
        `actionType=${ActionType.TASK_SHARED_UPDATE_MULTIPLE} entityCount=2`,
    );
    expect(
      Object.getOwnPropertyNames(err).filter(
        (property) => !['message', 'name', 'stack'].includes(property),
      ),
    ).toEqual([]);
    expect((OpLog.err as jasmine.Spy).calls.count()).toBe(0);
  });

  it('reduces untrusted metadata to placeholders', () => {
    // `actionType` and `entityIds` are unbounded on the wire, so a remote op can
    // carry anything. The message is user-visible and log-exported, so nothing
    // that is not allowlisted may survive into it.
    const hostile = new UnsupportedMultiEntityConflictError(
      'remote',
      '<img src=x onerror=alert(1)>',
      Number.POSITIVE_INFINITY,
    );

    expect(hostile.message).toBe(
      'SYNC_MULTI_ENTITY_UNSUPPORTED side=remote actionType=UNKNOWN entityCount=0',
    );
    expect(new UnsupportedMultiEntityConflictError('remote', 42, -1).message).toContain(
      'actionType=UNKNOWN entityCount=0',
    );
    expect(
      new UnsupportedMultiEntityConflictError(
        'remote',
        ActionType.TASK_SHARED_UPDATE_MULTIPLE,
        1_000_000,
      ).message,
    ).toContain('entityCount=9999');
  });

  it('never emits HTML-sensitive characters for any known action type', () => {
    // The sync-wrapper renders this message through an [innerHtml] snack. It
    // escapes on the way out, but the invariant that makes that escaping a
    // no-op is asserted here, over every reachable input rather than one sample.
    const messages = Object.values(ActionType).map(
      (actionType) =>
        new UnsupportedMultiEntityConflictError('local', actionType, 3).message,
    );
    messages.push(
      new UnsupportedMultiEntityConflictError('remote', '<script>', 3).message,
    );

    expect(messages.filter((message) => /[&<>"']/.test(message))).toEqual([]);
  });
});
