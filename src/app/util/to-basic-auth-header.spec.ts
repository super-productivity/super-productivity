import { toBasicAuthHeader } from './to-basic-auth-header';

// Expected values are literals from outside the implementation: the worked
// examples in RFC 7617, and `printf 'user:pw-€' | base64`.
describe('toBasicAuthHeader', () => {
  it('encodes ASCII credentials like btoa (RFC 7617 §2)', () => {
    expect(toBasicAuthHeader('Aladdin', 'open sesame')).toBe(
      'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
    );
    expect(toBasicAuthHeader('Aladdin', 'open sesame')).toBe(
      'Basic ' + btoa('Aladdin:open sesame'),
    );
  });

  it('encodes Latin-1 range characters as UTF-8 (RFC 7617 §2.1)', () => {
    expect(toBasicAuthHeader('test', '123£')).toBe('Basic dGVzdDoxMjPCow==');
  });

  it('encodes characters beyond Latin-1 instead of throwing', () => {
    expect(() => btoa('user:pw-€')).toThrow();
    expect(toBasicAuthHeader('user', 'pw-€')).toBe('Basic dXNlcjpwdy3igqw=');
  });

  it('treats missing credentials as empty', () => {
    expect(toBasicAuthHeader(null, undefined)).toBe('Basic ' + btoa(':'));
  });
});
