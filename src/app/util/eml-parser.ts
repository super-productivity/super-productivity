export interface ParsedEmlAddress {
  address: string;
  name?: string;
}

export interface ParsedEml {
  from?: ParsedEmlAddress;
  subject?: string;
  text?: string;
}

export const isFileEml = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.eml') || file.type === 'message/rfc822';
};

export const parseEml = async (file: File): Promise<ParsedEml> => {
  const content = (await file.text()).replace(/\r\n?/g, '\n');
  const separatorIndex = content.startsWith('\n') ? 0 : content.indexOf('\n\n');

  if (separatorIndex < 0) {
    throw new Error('Invalid EML: missing header/body separator');
  }

  const headers = _parseHeaders(content.slice(0, separatorIndex));
  const bodyStart = separatorIndex === 0 ? 1 : separatorIndex + 2;
  const body = content.slice(bodyStart);
  const mediaType = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const transferEncoding = headers.get('content-transfer-encoding')?.toLowerCase();
  const isPlainText = !mediaType || mediaType === 'text/plain';
  const isUnencoded =
    !transferEncoding || transferEncoding === '7bit' || transferEncoding === '8bit';

  return {
    from: _parseAddress(headers.get('from')),
    subject: headers.get('subject')?.trim() || undefined,
    text: isPlainText && isUnencoded ? body : undefined,
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
