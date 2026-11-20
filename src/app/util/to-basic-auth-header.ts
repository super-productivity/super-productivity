/**
 * HTTP Basic `Authorization` header value with the credentials encoded as
 * UTF-8 (RFC 7617), the same encoding WebDAV sync uses.
 *
 * `btoa` on the raw string would send `é` as one Latin-1 byte, which servers
 * that compare UTF-8 reject, and throw for anything above U+00FF such as `€`.
 */
export const toBasicAuthHeader = (
  userName: string | null | undefined,
  password: string | null | undefined,
): string => {
  const bytes = new TextEncoder().encode(`${userName ?? ''}:${password ?? ''}`);
  // Not `String.fromCharCode(...bytes)`: a spread overflows the stack on very long input.
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return `Basic ${btoa(binary)}`;
};
