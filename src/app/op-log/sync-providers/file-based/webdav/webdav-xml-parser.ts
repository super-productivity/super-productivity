import { PFLog } from '../../../../core/log';
import { RemoteFileNotFoundAPIError } from '../../../core/errors/sync-errors';

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

  constructor(private _cleanRev: (rev: string) => string) {}

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
      PFLog.error(
        `${WebdavXmlParser.L}.validateResponseContent() Content too large: ${content.length} bytes`,
      );
      throw new Error(
        `Response too large for ${operation} of ${path} (${content.length} bytes, max: ${maxSize})`,
      );
    }

    if (this.isHtmlResponse(content)) {
      PFLog.error(
        `${WebdavXmlParser.L}.${operation}() received HTML error page instead of ${expectedContentDescription}`,
        {
          path,
          responseSnippet: content.substring(0, 200),
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
      PFLog.error(
        `${WebdavXmlParser.L}.parseMultiplePropsFromXml() XML too large: ${xmlText.length} bytes`,
      );
      throw new RemoteFileNotFoundAPIError(
        `XML response too large (${xmlText.length} bytes)`,
      );
    }

    // Basic XML validation
    if (!xmlText.trim().startsWith('<?xml') && !xmlText.trim().startsWith('<')) {
      PFLog.error(
        `${WebdavXmlParser.L}.parseMultiplePropsFromXml() Invalid XML: doesn't start with <?xml or <`,
      );
      return [];
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        PFLog.err(
          `${WebdavXmlParser.L}.parseMultiplePropsFromXml() XML parsing error`,
          parserError.textContent,
        );
        return [];
      }

      const results: FileMeta[] = [];
      const responses = xmlDoc.querySelectorAll('response');

      for (const response of Array.from(responses)) {
        const href = response.querySelector('href')?.textContent?.trim();
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

        const fileMeta = this.parseXmlResponseElement(response, decodedHref);
        if (fileMeta) {
          results.push(fileMeta);
        }
      }

      return results;
    } catch (error) {
      PFLog.err(`${WebdavXmlParser.L}.parseMultiplePropsFromXml() parsing error`, error);
      return [];
    }
  }

  /**
   * Parse a single response element from WebDAV XML
   */
  parseXmlResponseElement(response: Element, requestPath: string): FileMeta | null {
    const href = response.querySelector('href')?.textContent?.trim();
    if (!href) return null;

    // Decode the href for processing
    const decodedHref = decodeURIComponent(href);

    const propstat = response.querySelector('propstat');
    if (!propstat) return null;

    const status = propstat.querySelector('status')?.textContent;
    if (!status?.includes('200 OK')) return null;

    const prop = propstat.querySelector('prop');
    if (!prop) return null;

    // Extract properties
    const displayname = prop.querySelector('displayname')?.textContent || '';
    const contentLength = prop.querySelector('getcontentlength')?.textContent || '0';
    const lastModified = prop.querySelector('getlastmodified')?.textContent || '';
    const etag = prop.querySelector('getetag')?.textContent || '';
    const resourceType = prop.querySelector('resourcetype');
    const contentType = prop.querySelector('getcontenttype')?.textContent || '';

    // Determine if it's a collection (directory) or file
    const isCollection =
      resourceType !== null && resourceType.querySelector('collection') !== null;

    return {
      filename: displayname || decodedHref.split('/').pop() || '',
      basename: displayname || decodedHref.split('/').pop() || '',
      lastmod: lastModified,
      size: parseInt(contentLength, 10),
      type: isCollection ? 'directory' : 'file',
      etag: lastModified, // Use lastmod as etag for consistency
      data: {
        /* eslint-disable @typescript-eslint/naming-convention */
        'content-type': contentType,
        'content-length': contentLength,
        'last-modified': lastModified,
        /* eslint-enable @typescript-eslint/naming-convention */
        etag: etag, // Keep original etag in data for reference
        href: decodedHref,
      },
      path: decodedHref,
    };
  }
}
