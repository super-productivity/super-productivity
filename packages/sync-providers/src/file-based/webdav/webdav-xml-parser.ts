import type { SyncLogger } from '@sp/sync-core';
import { RemoteFileNotFoundAPIError } from '../../errors';

// Runtime DOMParser: browsers (and Capacitor WebViews on Android/iOS)
// supply this global. The package's vitest env (Node) polyfills it via
// `@xmldom/xmldom` in `tests/setup-dom-parser.ts` — that dep stays in
// `devDependencies` so it does not ship to host bundles.
declare const DOMParser: {
  new (): {
    parseFromString(text: string, mimeType: string): XmlNodeLike;
  };
};

export interface FileMeta {
  filename: string;
  basename: string;
  lastmod: string;
  size: number;
  type: string;
  etag: string;
  data: Record<string, string>;
  path: string; // Full path/href from response
}

// Minimal structural typing of the parser node API we use. Browser
// DOMParser, Capacitor WebViews, and `@xmldom/xmldom` (test polyfill)
// all expose this surface. Matching by `localName` keeps namespace prefixes
// (e.g. `<D:response>` vs `<response>`) from affecting parsing.
interface XmlNodeLike {
  readonly textContent: string | null;
  readonly childNodes?: XmlNodeCollection;
  readonly localName?: string | null;
  readonly nodeName?: string | null;
}

interface XmlNodeCollection {
  readonly length: number;
  item(index: number): XmlNodeLike | null;
  [index: number]: XmlNodeLike | null;
}

interface DocumentScanResult {
  hasParserError: boolean;
  responses: XmlNodeLike[];
}

const getCollectionItem = (
  collection: XmlNodeCollection,
  index: number,
): XmlNodeLike | null => collection.item(index) ?? collection[index] ?? null;

const getLocalName = (node: XmlNodeLike): string => {
  if (node.localName) {
    return node.localName;
  }

  const nodeName = node.nodeName ?? '';
  const prefixIndex = nodeName.indexOf(':');
  return prefixIndex >= 0 ? nodeName.slice(prefixIndex + 1) : nodeName;
};

const hasLocalName = (node: XmlNodeLike, localName: string): boolean =>
  getLocalName(node) === localName;

const firstChild = (node: XmlNodeLike | null, localName: string): XmlNodeLike | null => {
  if (!node) return null;
  const children = node.childNodes;
  if (!children) return null;

  for (let i = 0; i < children.length; i++) {
    const child = getCollectionItem(children, i);
    if (child && hasLocalName(child, localName)) {
      return child;
    }
  }

  return null;
};

const firstChildText = (node: XmlNodeLike | null, localName: string): string => {
  const el = firstChild(node, localName);
  return el?.textContent ?? '';
};

const scanDocument = (node: XmlNodeLike): DocumentScanResult => {
  const result: DocumentScanResult = {
    hasParserError: false,
    responses: [],
  };

  const visit = (current: XmlNodeLike): void => {
    if (hasLocalName(current, 'parsererror')) {
      result.hasParserError = true;
      return;
    }

    if (hasLocalName(current, 'response')) {
      result.responses.push(current);
    }

    const children = current.childNodes;
    if (!children) return;

    for (let i = 0; i < children.length; i++) {
      const child = getCollectionItem(children, i);
      if (child) {
        visit(child);
      }
    }
  };

  visit(node);

  return result;
};

export class WebdavXmlParser {
  private static readonly L = 'WebdavXmlParser';
  // Maximum size for XML responses to prevent DoS attacks (10MB)
  private static readonly MAX_XML_SIZE = 10 * 1024 * 1024;

  static readonly PROPFIND_XML = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:getetag/>
    <D:resourcetype/>
    <D:getcontenttype/>
  </D:prop>
</D:propfind>`;

  constructor(private readonly _logger: SyncLogger) {}

  /**
   * Validates that response content is not an HTML error page
   * Used by operations that expect specific content types
   */
  validateResponseContent(
    content: string,
    path: string,
    operation: string,
    expectedContentDescription: string = 'content',
  ): void {
    // Check for size limits on file content
    const maxSize =
      expectedContentDescription === 'XML'
        ? WebdavXmlParser.MAX_XML_SIZE
        : WebdavXmlParser.MAX_XML_SIZE * 10; // Allow larger files for actual file content (100MB)

    if (content.length > maxSize) {
      this._logger.critical(
        `${WebdavXmlParser.L}.validateResponseContent() Content too large`,
        { contentLength: content.length, maxSize, operation },
      );
      throw new Error(
        `Response too large for ${operation} of ${path} (${content.length} bytes, max: ${maxSize})`,
      );
    }

    if (this.isHtmlResponse(content)) {
      // B3.x: never log the response body — only its shape/length.
      this._logger.critical(
        `${WebdavXmlParser.L}.${operation}() received HTML error page instead of ${expectedContentDescription}`,
        {
          contentLength: content.length,
          operation,
        },
      );
      throw new RemoteFileNotFoundAPIError(path);
    }
  }

  /**
   * Check if response is HTML instead of expected content
   */
  isHtmlResponse(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return (
      trimmed.startsWith('<!doctype html') ||
      trimmed.startsWith('<html') ||
      text.includes('There is nothing here, sorry')
    );
  }

  /**
   * Parse multiple file entries from PROPFIND XML response
   */
  parseMultiplePropsFromXml(xmlText: string, basePath: string): FileMeta[] {
    // Validate XML size
    if (xmlText.length > WebdavXmlParser.MAX_XML_SIZE) {
      this._logger.critical(
        `${WebdavXmlParser.L}.parseMultiplePropsFromXml() XML too large`,
        { xmlLength: xmlText.length },
      );
      throw new RemoteFileNotFoundAPIError(
        `XML response too large (${xmlText.length} bytes)`,
      );
    }

    // Basic XML validation
    if (!xmlText.trim().startsWith('<?xml') && !xmlText.trim().startsWith('<')) {
      this._logger.critical(
        `${WebdavXmlParser.L}.parseMultiplePropsFromXml() Invalid XML: doesn't start with <?xml or <`,
      );
      return [];
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      const scanResult = scanDocument(xmlDoc);
      if (scanResult.hasParserError) {
        this._logger.critical(
          `${WebdavXmlParser.L}.parseMultiplePropsFromXml() XML parsing error`,
          { errorName: 'XmlParserError' },
        );
        return [];
      }

      const results: FileMeta[] = [];
      const responses = scanResult.responses;

      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        if (!response) continue;
        const hrefEl = firstChild(response, 'href');
        const href = hrefEl?.textContent?.trim();
        if (!href) continue;

        const decodedHref = decodeURIComponent(href);

        // For single file queries (when we're looking for a specific file),
        // we should NOT skip the base path itself
        // Only skip if it's a directory listing (ends with /)
        const isDirectoryListing = basePath.endsWith('/');
        if (isDirectoryListing) {
          // Skip the base path itself (we only want children)
          // Normalize both paths: remove leading/trailing slashes for comparison
          const normalizedHref = decodedHref.replace(/^\//, '').replace(/\/$/, '');
          const normalizedBasePath = basePath.replace(/^\//, '').replace(/\/$/, '');

          if (normalizedHref === normalizedBasePath) {
            continue;
          }
        }

        const fileMeta = this.parseXmlResponseElement(response);
        if (fileMeta) {
          results.push(fileMeta);
        }
      }

      return results;
    } catch (error) {
      this._logger.critical(
        `${WebdavXmlParser.L}.parseMultiplePropsFromXml() parsing error`,
        { errorName: error instanceof Error ? error.name : 'Unknown' },
      );
      return [];
    }
  }

  /**
   * Parse a single response element from WebDAV XML
   */
  parseXmlResponseElement(response: XmlNodeLike): FileMeta | null {
    const hrefEl = firstChild(response, 'href');
    const href = hrefEl?.textContent?.trim();
    if (!href) return null;

    // Decode the href for processing
    const decodedHref = decodeURIComponent(href);

    const propstat = firstChild(response, 'propstat');
    if (!propstat) return null;

    const status = firstChild(propstat, 'status')?.textContent;
    if (!status?.includes('200 OK')) return null;

    const prop = firstChild(propstat, 'prop');
    if (!prop) return null;

    // Extract properties
    const displayname = firstChildText(prop, 'displayname');
    const contentLength = firstChildText(prop, 'getcontentlength') || '0';
    const lastModified = firstChildText(prop, 'getlastmodified');
    const etag = firstChildText(prop, 'getetag');
    const resourceType = firstChild(prop, 'resourcetype');
    const contentType = firstChildText(prop, 'getcontenttype');

    // Determine if it's a collection (directory) or file
    const isCollection =
      resourceType !== null && firstChild(resourceType, 'collection') !== null;

    const parsedSize = parseInt(contentLength, 10);
    const size = !isNaN(parsedSize) && parsedSize >= 0 ? parsedSize : 0;

    return {
      filename: displayname || decodedHref.split('/').pop() || '',
      basename: displayname || decodedHref.split('/').pop() || '',
      lastmod: lastModified,
      size,
      type: isCollection ? 'directory' : 'file',
      etag: lastModified, // Use lastmod as etag for consistency
      data: {
        /* eslint-disable @typescript-eslint/naming-convention */
        'content-type': contentType,
        'content-length': contentLength,
        'last-modified': lastModified,
        /* eslint-enable @typescript-eslint/naming-convention */
        etag, // Keep original etag in data for reference
        href: decodedHref,
      },
      path: decodedHref,
    };
  }
}
