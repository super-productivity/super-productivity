export interface ParsedEmlAddress {
  address: string;
  name?: string;
}

export interface ParsedEml {
  from?: ParsedEmlAddress;
  subject?: string;
  text?: string;
}

// Recursion is bounded because MIME nesting is attacker-controlled (multipart
// parts can themselves be multipart); this is just a sanity cap, not a
// real-world structure (mixed > related > alternative is 3 deep at most).
const MAX_MIME_DEPTH = 10;

// Matches the RFC 2231 spellings of the `name` parameter: the plain form,
// the encoded form (`name*`), and continuation segments (`name*0`,
// `name*0*`, `name*1`, ...). Presence-only match — the value is never
// decoded/reassembled since we only need to know a filename hint exists.
const _NAME_PARAM_KEY_RE = /^name(\*\d*\*?)?$/;

// Same RFC 2231 spellings for the `Content-Disposition` `filename` parameter
// (`filename`, `filename*`, `filename*0`, `filename*0*`, ...); presence-only.
const _FILENAME_PARAM_KEY_RE = /^filename(\*\d*\*?)?$/;

/**
 * Minimal, dependency-free RFC 822 / MIME reader for the drop-an-`.eml` feature.
 *
 * Intentionally NOT a full MIME parser. `text` is only populated from a single
 * UTF-8/US-ASCII `text/plain` part, found by walking `multipart/*` structures
 * (bounded depth) for the first such leaf; `7bit`/`8bit`/unencoded,
 * `quoted-printable`, and `base64` transfer encodings on that leaf are decoded.
 * Any attachment-like part (leaf or multipart container) is skipped entirely,
 * so an attached file can never shadow or be mistaken for the actual message
 * body: a `Content-Disposition` other than `inline` (recognized or not, per
 * RFC 2183 §2.8), or — since `Content-Disposition` is optional — the legacy
 * pre-`Content-Disposition` `Content-Type; name=` filename hint (including its
 * RFC 2231 encoded/continued spellings, `name*`/`name*0`/`name*0*`/...). HTML
 * bodies and non-UTF-8/ASCII charsets are still omitted by design
 * (`text: undefined`), never decoded.
 * The caller stores the body as an untrusted, inert note, so we favour safety
 * and simplicity over completeness; do not add HTML decoding or charset
 * transcoding here without revisiting that threat model (untrusted-HTML XSS,
 * main-thread cost, op-log/sync size).
 *
 * Headers ARE decoded (RFC 2047 encoded-words), because the sender/subject become
 * the always-visible task title where raw `=?UTF-8?...?=` would be unreadable.
 */
export const parseEml = async (file: File): Promise<ParsedEml> => {
  const content = (await file.text()).replace(/\r\n?/g, '\n');
  const split = _splitHeadersAndBody(content);

  if (!split) {
    throw new Error('Invalid EML: missing header/body separator');
  }

  const { headers, body } = split;

  return {
    from: _parseAddress(headers.get('from')),
    subject: _decodeEncodedWords(headers.get('subject') ?? '').trim() || undefined,
    text: _extractPlainText(headers, body, 0),
  };
};

const _splitHeadersAndBody = (
  raw: string,
): { headers: Map<string, string>; body: string } | undefined => {
  const separatorIndex = raw.startsWith('\n') ? 0 : raw.indexOf('\n\n');

  if (separatorIndex < 0) {
    return undefined;
  }

  const headers = _parseHeaders(raw.slice(0, separatorIndex));
  const bodyStart = separatorIndex === 0 ? 1 : separatorIndex + 2;

  return { headers, body: raw.slice(bodyStart) };
};

// Walks a MIME entity (message or multipart part): recurses into `multipart/*`
// looking for the first supported `text/plain` leaf, decoding its transfer
// encoding once found. Returns undefined if no such leaf exists (e.g.
// HTML-only, unsupported charset, or a malformed/over-deep structure).
const _extractPlainText = (
  headers: Map<string, string>,
  body: string,
  depth: number,
): string | undefined => {
  if (depth > MAX_MIME_DEPTH) {
    return undefined;
  }

  const { mediaType, charset, boundary, name } = _parseContentType(
    headers.get('content-type'),
  );

  // Skip the whole subtree for anything attachment-like — leaf or multipart
  // container alike — so an attached file never shadows or is mistaken for
  // the actual message body.
  if (_isAttachmentPart(headers, name)) {
    return undefined;
  }

  if (mediaType?.startsWith('multipart/')) {
    if (!boundary) {
      return undefined;
    }
    for (const rawPart of _splitMultipartParts(body, boundary)) {
      const split = _splitHeadersAndBody(rawPart);
      if (!split) {
        continue;
      }
      const text = _extractPlainText(split.headers, split.body, depth + 1);
      if (text !== undefined) {
        return text;
      }
    }
    return undefined;
  }

  const isPlainText = !mediaType || mediaType === 'text/plain';
  const isSupportedCharset =
    charset === undefined || charset === 'us-ascii' || charset === 'utf-8';

  if (!isPlainText || !isSupportedCharset) {
    return undefined;
  }

  // Take only the leading token so a value like `7bit (comment)` still matches.
  const transferEncoding = headers
    .get('content-transfer-encoding')
    ?.trim()
    .split(/[\s(;]/)[0]
    .toLowerCase();

  if (!transferEncoding || transferEncoding === '7bit' || transferEncoding === '8bit') {
    return body;
  }
  if (transferEncoding === 'quoted-printable') {
    return _decodeQuotedPrintable(body);
  }
  if (transferEncoding === 'base64') {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(_base64ToBytes(body));
    } catch {
      return undefined;
    }
  }

  return undefined;
};

// RFC 2183 §2.8: a present disposition type other than `inline` — whether
// recognized (`attachment`) or not (`x-download`, or malformed with a
// `filename` param but no parseable type) — is treated as an attachment.
// `Content-Disposition` is optional, so a part with none is only flagged via
// the legacy pre-Content-Disposition `Content-Type; name=` filename hint.
const _isAttachmentPart = (
  headers: Map<string, string>,
  contentTypeName?: string,
): boolean => {
  const { type: dispositionType, hasFilename } = _parseContentDisposition(
    headers.get('content-disposition'),
  );

  if (dispositionType !== undefined) {
    return dispositionType !== 'inline';
  }
  if (hasFilename) {
    return true;
  }

  return contentTypeName !== undefined;
};

// Splits a multipart body on its boundary delimiter line-by-line (RFC 2046),
// discarding the preamble (before the first delimiter) and epilogue (after the
// closing `--boundary--` delimiter). Malformed/unterminated multipart bodies
// simply yield fewer (or no) parts rather than throwing.
const _splitMultipartParts = (body: string, boundary: string): string[] => {
  const openDelimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;
  const parts: string[] = [];
  let current: string[] | undefined;

  for (const line of body.split('\n')) {
    const trimmed = line.replace(/[ \t]+$/, '');

    if (trimmed === closeDelimiter) {
      if (current) {
        parts.push(current.join('\n'));
      }
      return parts;
    }
    if (trimmed === openDelimiter) {
      if (current) {
        parts.push(current.join('\n'));
      }
      current = [];
      continue;
    }
    current?.push(line);
  }

  return parts;
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

// Split a header value's `;`-separated parameters, but not inside a
// double-quoted value, so a `charset=`/`filename=` embedded in another quoted
// parameter can't be mistaken for the real one. The leading token (media type
// or disposition type) is `parts[0]`; parameters are `parts[1..]`.
const _splitParams = (value: string): string[] => {
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
  return parts;
};

// RFC 2183 disposition-type + presence of a `filename` parameter (in any RFC
// 2231 spelling: `filename`, `filename*`, `filename*0`, ...). A disposition
// value that fails to parse a leading token (e.g. malformed, leading straight
// into `; filename=...`) still surfaces `hasFilename` so the caller can fall
// back on that signal.
const _parseContentDisposition = (
  value?: string,
): { type?: string; hasFilename: boolean } => {
  if (!value) {
    return { hasFilename: false };
  }

  const parts = _splitParams(value);
  const type = parts[0].trim().split(/[\s(]/)[0].toLowerCase() || undefined;
  const hasFilename = parts.slice(1).some((part) => {
    const eq = part.indexOf('=');
    return eq >= 0 && _FILENAME_PARAM_KEY_RE.test(part.slice(0, eq).trim().toLowerCase());
  });

  return { type, hasFilename };
};

const _parseContentType = (
  value?: string,
): { mediaType?: string; charset?: string; boundary?: string; name?: string } => {
  if (!value) {
    return {};
  }

  const parts = _splitParams(value);

  // The media type is the first token; drop any trailing RFC 822 comment/whitespace.
  const mediaType = parts[0].trim().split(/[\s(]/)[0].toLowerCase() || undefined;

  let charset: string | undefined;
  let boundary: string | undefined;
  let name: string | undefined;
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = part.slice(0, eq).trim().toLowerCase();
    const rawValue = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '');

    if (key === 'charset') {
      charset = rawValue.toLowerCase();
    } else if (key === 'boundary') {
      // Boundary values are case-sensitive and must match the body's delimiter
      // lines verbatim, unlike charset.
      boundary = rawValue;
    } else if (_NAME_PARAM_KEY_RE.test(key)) {
      // Legacy pre-Content-Disposition filename hint (RFC 2045), including
      // RFC 2231 encoded/continued forms (`name*`, `name*0`, `name*0*`, ...).
      // Presence alone is enough to flag the part as attachment-like, so the
      // value is never decoded or reconstructed.
      name = rawValue;
    }
  }

  return { mediaType, charset, boundary, name };
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

// RFC 2045 quoted-printable body decoder. Unlike the RFC 2047 header variant
// (`_qToBytes`), `_` is literal here, and a trailing `=` before a line break is
// a soft line break (join, no newline) rather than data.
const _decodeQuotedPrintable = (input: string): string => {
  const joined = input.replace(/=\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const char = joined[i];
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(char.charCodeAt(0) & 0xff);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
};
