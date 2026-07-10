export interface ParsedEmlAddress {
  address: string;
  name?: string;
}

export interface ParsedEml {
  from?: ParsedEmlAddress;
  subject?: string;
  text?: string;
}

export const parseEml = async (file: File): Promise<ParsedEml> => {
  const content = (await file.text()).replace(/\r\n?/g, '\n');
  const separatorIndex = content.startsWith('\n') ? 0 : content.indexOf('\n\n');

  if (separatorIndex < 0) {
    throw new Error('Invalid EML: missing header/body separator');
  }

  const headers = _parseHeaders(content.slice(0, separatorIndex));
  const bodyStart = separatorIndex === 0 ? 1 : separatorIndex + 2;
  const body = content.slice(bodyStart);
  const contentType = headers.get('content-type');
  const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase();
  const charsetMatch = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|([^;\s]*))/i.exec(
    contentType || '',
  );
  const charset = charsetMatch
    ? (charsetMatch[1] ?? charsetMatch[2] ?? '').toLowerCase()
    : undefined;
  const transferEncoding = headers.get('content-transfer-encoding')?.toLowerCase();
  const isPlainText = !mediaType || mediaType === 'text/plain';
  const isUnencoded =
    !transferEncoding || transferEncoding === '7bit' || transferEncoding === '8bit';
  const isSupportedCharset =
    charset === undefined || charset === 'us-ascii' || charset === 'utf-8';

  return {
    from: _parseAddress(headers.get('from')),
    subject: headers.get('subject')?.trim() || undefined,
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
    const name = rawName.replace(/^"|"$/g, '').trim();

    return address ? { address, name: name || undefined } : undefined;
  }

  const address = fromHeader.split(',', 1)[0].trim();
  return address ? { address } : undefined;
};
