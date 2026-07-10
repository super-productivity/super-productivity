export interface ParsedEmlAddress {
  address: string;
  name?: string;
}

export interface ParsedEml {
  from?: ParsedEmlAddress;
  subject?: string;
  text?: string;
}

/**
 * Minimal, dependency-free RFC 822 / MIME reader for the drop-an-`.eml` feature.
 *
 * Intentionally NOT a full MIME parser. A body is only returned as `text` when it
 * is a single, unencoded, UTF-8/US-ASCII `text/plain` part; multipart, HTML,
 * transfer-encoded (base64/quoted-printable) and non-UTF-8/ASCII bodies are
 * omitted by design (`text: undefined`) — never decoded. The caller stores the
 * body as an untrusted, inert note, so we favour safety and simplicity over
 * completeness; do not add body decoding here without revisiting that threat
 * model (untrusted-HTML XSS, main-thread cost, op-log/sync size).
 *
 * Headers ARE decoded (RFC 2047 encoded-words), because the sender/subject become
 * the always-visible task title where raw `=?UTF-8?...?=` would be unreadable.
 */
export const parseEml = async (file: File): Promise<ParsedEml> => {
  const content = (await file.text()).replace(/\r\n?/g, '\n');
  const separatorIndex = content.startsWith('\n') ? 0 : content.indexOf('\n\n');

  if (separatorIndex < 0) {
    throw new Error('Invalid EML: missing header/body separator');
  }

  const headers = _parseHeaders(content.slice(0, separatorIndex));
  const bodyStart = separatorIndex === 0 ? 1 : separatorIndex + 2;
  const body = content.slice(bodyStart);

  const { mediaType, charset } = _parseContentType(headers.get('content-type'));
  // Take only the leading token so a value like `7bit (comment)` still matches.
  const transferEncoding = headers
    .get('content-transfer-encoding')
    ?.trim()
    .split(/[\s(;]/)[0]
    .toLowerCase();
  const isPlainText = !mediaType || mediaType === 'text/plain';
  const isUnencoded =
    !transferEncoding || transferEncoding === '7bit' || transferEncoding === '8bit';
  const isSupportedCharset =
    charset === undefined || charset === 'us-ascii' || charset === 'utf-8';

  return {
    from: _parseAddress(headers.get('from')),
    subject: _decodeEncodedWords(headers.get('subject') ?? '').trim() || undefined,
    text: isPlainText && isUnencoded && isSupportedCharset ? body : undefined,
  };
};

const _parseHeaders = (headerBlock: string): Map<string, string> => {
  const headers = new Map<string, string>();
  const unfoldedHeaders = headerBlock.replace(/\n[ \t]+/g, ' ');

  for (const line of unfoldedHeaders.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    if (!headers.has(name)) {
      headers.set(name, line.slice(separatorIndex + 1).trim());
    }
  }

  return headers;
};

const _parseAddress = (fromHeader?: string): ParsedEmlAddress | undefined => {
  if (!fromHeader) {
    return undefined;
  }

  const angleStart = fromHeader.indexOf('<');
  const angleEnd = fromHeader.indexOf('>', angleStart + 1);

  if (angleStart >= 0 && angleEnd > angleStart) {
    const address = fromHeader.slice(angleStart + 1, angleEnd).trim();
    const rawName = fromHeader.slice(0, angleStart).trim();
    const name = _decodeEncodedWords(rawName.replace(/^"|"$/g, '')).trim();

    return address ? { address, name: name || undefined } : undefined;
  }

  const address = fromHeader.split(',', 1)[0].trim();
  return address ? { address } : undefined;
};

const _parseContentType = (value?: string): { mediaType?: string; charset?: string } => {
  if (!value) {
    return {};
  }

  // Split parameters on ';', but not inside a double-quoted value, so a `charset=`
  // embedded in another quoted parameter (e.g. a filename) can't be mistaken for
  // the real charset.
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of value) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ';' && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  // The media type is the first token; drop any trailing RFC 822 comment/whitespace.
  const mediaType = parts[0].trim().split(/[\s(]/)[0].toLowerCase() || undefined;

  let charset: string | undefined;
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim().toLowerCase() !== 'charset') {
      continue;
    }
    charset = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '')
      .toLowerCase();
  }

  return { mediaType, charset };
};

// Decode RFC 2047 encoded-words (`=?charset?B|Q?text?=`) for the UTF-8/US-ASCII
// case so international subjects/names are readable. Unsupported charsets and
// malformed words are left verbatim rather than throwing.
const _decodeEncodedWords = (value: string): string =>
  // Whitespace separating two adjacent encoded-words is not significant (RFC 2047).
  value
    .replace(/(=\?[^?]*\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]*\?[BbQq]\?)/g, '$1')
    .replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (match, charset: string, encoding: string, text: string) => {
        const cs = charset.toLowerCase();
        if (cs !== 'utf-8' && cs !== 'us-ascii' && cs !== 'ascii') {
          return match;
        }
        try {
          const bytes =
            encoding.toUpperCase() === 'B' ? _base64ToBytes(text) : _qToBytes(text);
          return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        } catch {
          return match;
        }
      },
    );

const _base64ToBytes = (input: string): Uint8Array => {
  const binary = atob(input.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const _qToBytes = (input: string): Uint8Array => {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '_') {
      bytes.push(0x20);
    } else if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(input.slice(i + 1, i + 3))) {
      bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(char.charCodeAt(0) & 0xff);
    }
  }
  return new Uint8Array(bytes);
};
