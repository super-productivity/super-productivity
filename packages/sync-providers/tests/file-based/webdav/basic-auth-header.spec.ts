import { describe, expect, it } from 'vitest';
import { toBasicAuthHeader } from '../../../src/file-based/webdav/basic-auth-header';

// Expected values are literals from outside the implementation: the worked
// examples in RFC 7617, and `printf 'e2e-euro:pw-€-e2e' | base64` (a value the
// Apache e2e server accepts).
describe('toBasicAuthHeader', () => {
  it('encodes ASCII credentials (RFC 7617 §2)', () => {
    expect(toBasicAuthHeader('Aladdin', 'open sesame')).toBe(
      'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
    );
  });

  it('encodes Latin-1 range characters as UTF-8 (RFC 7617 §2.1)', () => {
    expect(toBasicAuthHeader('test', '123£')).toBe('Basic dGVzdDoxMjPCow==');
  });

  it('encodes characters beyond Latin-1 instead of throwing', () => {
    expect(toBasicAuthHeader('e2e-euro', 'pw-€-e2e')).toBe(
      'Basic ZTJlLWV1cm86cHct4oKsLWUyZQ==',
    );
  });
});
