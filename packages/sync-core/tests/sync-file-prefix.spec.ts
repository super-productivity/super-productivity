import { describe, expect, it } from 'vitest';
import { createSyncFilePrefixHelpers } from '../src';
import type { SyncFilePrefixInvalidPrefixDetails } from '../src';
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
      prefixAt: -1,
      headShape: 'other',
    });
  });

  // #9627: the details said how long the body was and what we expected, but
  // nothing about what we actually got — so a single field report cost five
  // round-trips and still did not settle whether the failure was a bad
  // RESPONSE or a bad STORED FILE. These pin the classification, which is the
  // whole point of the diagnostic.
  describe('head-shape diagnostics (#9627)', () => {
    // Synthetic stand-in for the reporter's ciphertext head. Same shape (plain
    // base64, no padding, longer than MIN_BASE64_HEAD_LENGTH) without copying a
    // user's bytes into source control.
    const CIPHERTEXT_HEAD = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY';

    const detailsFor = (dataStr: string): SyncFilePrefixInvalidPrefixDetails => {
      let received: SyncFilePrefixInvalidPrefixDetails | undefined;
      const helpers = createSyncFilePrefixHelpers({
        prefix: 'pf_',
        createInvalidPrefixError: (details) => {
          received = details;
          return new Error('invalid');
        },
      });
      expect(() => helpers.extractSyncFileStateFromPrefix(dataStr)).toThrow();
      expect(received).toBeDefined();
      return received!;
    };

    it('reads our own ciphertext with a lost header as base64 + no prefix', () => {
      // The #9627 shape: encrypted payload intact, `pf_...__` head gone.
      expect(detailsFor(CIPHERTEXT_HEAD)).toMatchObject({
        headShape: 'base64',
        prefixAt: -1,
      });
    });

    it('reads a proxy page / WebDAV multistatus as markup', () => {
      expect(detailsFor('<?xml version="1.0"?><d:multistatus/>')).toMatchObject({
        headShape: 'markup',
      });
      expect(detailsFor('<!DOCTYPE html><html>login</html>')).toMatchObject({
        headShape: 'markup',
      });
    });

    it('reads an error envelope as json', () => {
      expect(detailsFor('{"error":"unauthorized"}')).toMatchObject({
        headShape: 'json',
      });
      expect(detailsFor('[1,2,3]')).toMatchObject({ headShape: 'json' });
    });

    it('also reads our own PLAINTEXT body as json — the shape is ambiguous', () => {
      // Compression and encryption are both off by default, so an unencrypted
      // stored file is raw JSON and is indistinguishable here from an error
      // envelope. Pinned so nobody reads `json` as "definitely a bad response";
      // the interface doc says to resolve it with the reporter's sync settings.
      expect(detailsFor('{"version":2,"lastUpdate":123,"ops":[]}')).toMatchObject({
        headShape: 'json',
      });
    });

    it('rejects non-canonical base64 with padding in the middle', () => {
      // Our writers use btoa, which pads only at the end. A body with `=`
      // mid-string is something else (`status=failedauth`), not our payload.
      expect(detailsFor('AAAA=BBBB=CCCC=DD').headShape).toBe('other');
    });

    it('does not mistake a short plaintext error body for our ciphertext', () => {
      // Bare alphabetic bodies are valid base64 by alphabet alone. Calling them
      // `base64` would point the reader at the STORED file when the truth is a
      // bad RESPONSE — the exact inversion the diagnostic exists to prevent.
      expect(detailsFor('Unauthorized').headShape).toBe('other');
      expect(detailsFor('nginx').headShape).toBe('other');
    });

    it('still recognizes ciphertext when the body has leading whitespace', () => {
      // All three tests read the same trimmed view; classifying markup/json
      // trimmed but base64 raw would demote this to `other`.
      expect(detailsFor(`  ${CIPHERTEXT_HEAD}`)).toMatchObject({
        headShape: 'base64',
      });
    });

    it('reports the offset when the header is DAMAGED rather than missing', () => {
      // `pf_` still there, separator gone. Different cause from a head-strip,
      // and prefixAt is the only thing that tells them apart.
      expect(detailsFor('pf_E2_payload')).toMatchObject({ prefixAt: 0 });
    });

    it('finds a prefix pushed past the head sample by prepended junk', () => {
      // prefixAt searches the whole body: bounding it to the 64-char sample
      // reported -1 here, conflating "junk prepended" with "prefix absent".
      expect(detailsFor(`${'x'.repeat(70)}pf_CE2__{}`)).toMatchObject({
        prefixAt: 70,
      });
    });

    it('samples only the head, so a long body cannot bloat the diagnostic', () => {
      const details = detailsFor('<html>' + 'x'.repeat(5000));
      expect(details.headShape).toBe('markup');
      expect(details.inputLength).toBe(5006);
      // No field carries the payload itself.
      expect(JSON.stringify(details)).not.toContain('xxxx');
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
