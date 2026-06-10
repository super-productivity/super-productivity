import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '../src';

describe('extractErrorMessage', () => {
  it('returns non-empty string errors', () => {
    expect(extractErrorMessage('plain failure')).toBe('plain failure');
    expect(extractErrorMessage('')).toBeNull();
  });

  it('prefers an Error cause message when present', () => {
    const err = new Error('outer message', {
      cause: new Error('inner cause'),
    });

    expect(extractErrorMessage(err)).toBe('inner cause');
  });

  it('returns error codes without host-specific normalization', () => {
    const err = new Error('');
    Object.defineProperty(err, 'code', {
      value: 'Z_BUF_ERROR',
    });

    expect(extractErrorMessage(err)).toBe('Z_BUF_ERROR');
  });

  it('returns non-zlib error codes before empty messages', () => {
    const err = new Error('');
    Object.defineProperty(err, 'code', {
      value: 'ERR_SYNC',
    });

    expect(extractErrorMessage(err)).toBe('ERR_SYNC');
  });

  it('falls back to the Error message', () => {
    expect(extractErrorMessage(new Error('direct message'))).toBe('direct message');
  });

  it('reads a message property from plain objects', () => {
    expect(extractErrorMessage({ message: 'object message' })).toBe('object message');
  });

  it('returns null for unsupported values', () => {
    expect(extractErrorMessage(undefined)).toBeNull();
    expect(extractErrorMessage({ message: 123 })).toBeNull();
  });
});
