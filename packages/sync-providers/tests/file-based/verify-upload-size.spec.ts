import { describe, expect, it } from 'vitest';
import { assertUploadedSizeMatches } from '../../src/file-based/verify-upload-size';
import { UploadRevToMatchMismatchAPIError } from '../../src/errors';

describe('assertUploadedSizeMatches', () => {
  it('passes when the stored size matches the ASCII payload byte length', () => {
    expect(() => assertUploadedSizeMatches('test', 4, 'sync-data.json')).not.toThrow();
  });

  it('throws when an ASCII payload was stored truncated (fewer bytes)', () => {
    expect(() => assertUploadedSizeMatches('test', 2, 'sync-data.json')).toThrow(
      UploadRevToMatchMismatchAPIError,
    );
  });

  it('throws when an ASCII payload was stored larger than sent', () => {
    expect(() => assertUploadedSizeMatches('test', 9, 'sync-data.json')).toThrow(
      UploadRevToMatchMismatchAPIError,
    );
  });

  it('skips (fails open) when the response omits size', () => {
    expect(() =>
      assertUploadedSizeMatches('test', undefined, 'sync-data.json'),
    ).not.toThrow();
  });

  it('skips multi-byte payloads even when the size clearly mismatches', () => {
    // 'café' = 4 UTF-16 code units but 5 UTF-8 bytes. The byte-count check is
    // only transport-safe for pure-ASCII payloads, so a non-ASCII payload must
    // never throw — otherwise a transport that encodes differently than
    // TextEncoder would falsely loop. 2 matches neither 4 nor 5.
    expect(() => assertUploadedSizeMatches('café', 2, 'sync-data.json')).not.toThrow();
  });

  it('skips a multi-byte payload even when size equals the UTF-8 byte length', () => {
    // Still skipped: we deliberately do not trust the comparison for non-ASCII.
    expect(() => assertUploadedSizeMatches('café', 5, 'sync-data.json')).not.toThrow();
  });

  it('includes the target path and both byte counts in the error', () => {
    let caught: Error | undefined;
    try {
      assertUploadedSizeMatches('test', 2, 'sync-data.json');
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toContain('sync-data.json');
    expect(caught?.message).toContain('2');
    expect(caught?.message).toContain('4');
  });
});
