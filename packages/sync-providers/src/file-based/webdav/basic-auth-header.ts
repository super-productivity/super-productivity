/**
 * HTTP Basic `Authorization` header value with the credentials encoded as
 * UTF-8 (RFC 7617), which is what browsers send and what servers that hash the
 * password as typed (Nextcloud, Apache, nginx) compare against.
 *
 * `btoa` on the raw string would send `é` as one Latin-1 byte (401 on those
 * servers) and throw for anything above U+00FF such as `€`.
 */
export const toBasicAuthHeader = (userName: string, password: string): string => {
  const bytes = new TextEncoder().encode(`${userName}:${password}`);
  // Not `String.fromCharCode(...bytes)`: a spread overflows the stack on very long input.
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return `Basic ${btoa(binary)}`;
};
