import { describe, expect, it } from 'vitest';
import { createSyncFilePrefixHelpers } from '../src';
import { SyncFilePrefixError, SyncFilePrefixVersionError } from '../src/sync-file-prefix';

describe('createSyncFilePrefixHelpers', () => {
  it('formats prefixes with host-supplied prefix and default separator', () => {
    const helpers = createSyncFilePrefixHelpers({ prefix: 'pf_' });

    expect(
      helpers.getSyncFilePrefix({
        isCompress: true,
        isEncrypt: true,
        modelVersion: 17,
      }),
    ).toBe('pf_CE17__');
    expect(
      helpers.getSyncFilePrefix({
        isCompress: false,
        isEncrypt: false,
        modelVersion: 17,
      }),
    ).toBe('pf_17__');
  });

  it('extracts prefix state and leaves the payload untouched', () => {
    const helpers = createSyncFilePrefixHelpers({ prefix: 'pf_' });

    expect(helpers.extractSyncFileStateFromPrefix('pf_CE17__{"task":[]}')).toEqual({
      isCompressed: true,
      isEncrypted: true,
      modelVersion: 17,
      cleanDataStr: '{"task":[]}',
    });
  });

  it('supports decimal model versions for existing sync file compatibility', () => {
    const helpers = createSyncFilePrefixHelpers({ prefix: 'pf_' });

    expect(helpers.extractSyncFileStateFromPrefix('pf_C16.5__{}')).toEqual({
      isCompressed: true,
      isEncrypted: false,
      modelVersion: 16.5,
      cleanDataStr: '{}',
    });
  });

  it('escapes regex characters in host prefix and separator', () => {
    const helpers = createSyncFilePrefixHelpers({
      prefix: 'host.sync+',
      endSeparator: '.*',
    });

    expect(
      helpers.getSyncFilePrefix({ isCompress: true, isEncrypt: false, modelVersion: 1 }),
    ).toBe('host.sync+C1.*');
    expect(helpers.extractSyncFileStateFromPrefix('host.sync+C1.*payload')).toEqual({
      isCompressed: true,
      isEncrypted: false,
      modelVersion: 1,
      cleanDataStr: 'payload',
    });
  });

  it('uses the host invalid-prefix error factory when supplied', () => {
    class HostInvalidPrefixError extends Error {
      override name = 'HostInvalidPrefixError';
    }
    let receivedDetails: unknown;

    const helpers = createSyncFilePrefixHelpers({
      prefix: 'pf_',
      createInvalidPrefixError: (details) => {
        receivedDetails = details;
        return new HostInvalidPrefixError(`invalid length ${details.inputLength}`);
      },
    });

    expect(() => helpers.extractSyncFileStateFromPrefix('bad secret payload')).toThrow(
      HostInvalidPrefixError,
    );
    expect(receivedDetails).toEqual({
      expectedPrefix: 'pf_',
      endSeparator: '__',
      inputLength: 'bad secret payload'.length,
    });
  });

  it('throws a generic package error without a host error factory', () => {
    const helpers = createSyncFilePrefixHelpers({ prefix: 'pf_' });

    expect(() => helpers.extractSyncFileStateFromPrefix('bad')).toThrow(
      SyncFilePrefixError,
    );
  });

  it('rejects formatted model versions that the parser cannot read back', () => {
    const helpers = createSyncFilePrefixHelpers({ prefix: 'pf_' });

    for (const modelVersion of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1e21]) {
      expect(() =>
        helpers.getSyncFilePrefix({
          isCompress: false,
          isEncrypt: false,
          modelVersion,
        }),
      ).toThrow(SyncFilePrefixVersionError);
    }
  });

  it('rejects parsed model versions that overflow to Infinity', () => {
    const helpers = createSyncFilePrefixHelpers({ prefix: 'pf_' });

    expect(() =>
      helpers.extractSyncFileStateFromPrefix(`pf_${'9'.repeat(400)}__{}`),
    ).toThrow(SyncFilePrefixVersionError);
  });

  it('bounds rejected model-version text in error messages', () => {
    const helpers = createSyncFilePrefixHelpers({ prefix: 'pf_' });

    try {
      helpers.extractSyncFileStateFromPrefix(`pf_${'9'.repeat(400)}__{}`);
      throw new Error('Expected invalid model version to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SyncFilePrefixVersionError);
      expect((error as Error).message.length).toBeLessThan(100);
    }
  });
});
