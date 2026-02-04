import { WebdavPrivateCfg } from './webdav.model';
import { Log, SyncLog } from '../../../../core/log';
import { FileMeta, WebdavXmlParser } from './webdav-xml-parser';
import { WebDavHttpAdapter, WebDavHttpResponse } from './webdav-http-adapter';
import {
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  NoRevAPIError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
} from '../../../core/errors/sync-errors';
import { WebDavHttpHeader, WebDavHttpMethod, WebDavHttpStatus } from './webdav.const';

export class WebdavApi {
  private static readonly L = 'WebdavApi';
  private xmlParser: WebdavXmlParser;
  private httpAdapter: WebDavHttpAdapter;
  private directoryCreationQueue = new Map<string, Promise<void>>();

  constructor(private _getCfgOrError: () => Promise<WebdavPrivateCfg>) {
    this.xmlParser = new WebdavXmlParser((rev: string) => this._cleanRev(rev));
    this.httpAdapter = new WebDavHttpAdapter();
  }

  // ==============================
  // File Operations
  // ==============================

  async listFiles(dirPath: string): Promise<string[]> {
    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, dirPath);

    try {
      const response = await this._makeRequest({
        url: fullPath,
        method: WebDavHttpMethod.PROPFIND,
        body: WebdavXmlParser.PROPFIND_XML,
        headers: {
          [WebDavHttpHeader.CONTENT_TYPE]: 'application/xml; charset=utf-8',
          [WebDavHttpHeader.DEPTH]: '1', // Get direct children
        },
      });

      if (response.status === WebDavHttpStatus.MULTI_STATUS) {
        const filesAndFolders = this.xmlParser.parseMultiplePropsFromXml(
          response.data,
          dirPath,
        );
        // Filter out directories and the current folder itself, return only file paths
        return filesAndFolders
          .filter(
            (item) => item.type === 'file' && item.path !== dirPath, // Don't include the folder itself
          )
          .map((item) => item.path);
      } else if (response.status === WebDavHttpStatus.NOT_FOUND) {
        return []; // Directory not found, return empty list
      }
      // Create a fake Response object for the error
      const errorResponse = new Response(response.data, {
        status: response.status,
        statusText: `HTTP ${response.status}`,
      });
      throw new HttpNotOkAPIError(errorResponse); // Other errors
    } catch (e) {
      SyncLog.error(`${WebdavApi.L}.listFiles() error for path: ${dirPath}`, e);
      // Handle "Not Found" error specifically to return empty array
      if (
        e instanceof HttpNotOkAPIError &&
        e.response?.status === WebDavHttpStatus.NOT_FOUND
      ) {
        return [];
      }
      throw e;
    }
  }

  /**
   * Retrieve metadata for a file or folder
   */
  async getFileMeta(
    path: string,
    _localRev: string | null,
    useGetFallback: boolean = false,
  ): Promise<FileMeta> {
    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
      // Try PROPFIND first
      const response = await this._makeRequest({
        url: fullPath,
        method: WebDavHttpMethod.PROPFIND,
        body: WebdavXmlParser.PROPFIND_XML,
        headers: {
          [WebDavHttpHeader.CONTENT_TYPE]: 'application/xml; charset=utf-8',
          [WebDavHttpHeader.DEPTH]: '0',
        },
      });

      if (response.status === WebDavHttpStatus.MULTI_STATUS) {
        const files = this.xmlParser.parseMultiplePropsFromXml(response.data, path);
        if (files && files.length > 0) {
          const meta = files[0];
          SyncLog.verbose(`${WebdavApi.L}.getFileMeta() PROPFIND success for ${path}`, {
            lastmod: meta.lastmod,
          });
          return meta;
        }
      }
    } catch (e) {
      // If PROPFIND fails and fallback is enabled, try HEAD
      if (useGetFallback) {
        SyncLog.verbose(
          `${WebdavApi.L}.getFileMeta() PROPFIND failed, trying HEAD fallback`,
          e,
        );
        try {
          return await this._getFileMetaViaHead(fullPath);
        } catch (headErr) {
          SyncLog.warn(
            `${WebdavApi.L}.getFileMeta() HEAD fallback failed for ${path}`,
            headErr,
          );
          // If HEAD also fails, throw the original error (or maybe the HEAD error?)
          // Usually the original PROPFIND error is more informative about connectivity
        }
      }
      SyncLog.error(`${WebdavApi.L}.getFileMeta() error`, { path, error: e });
      throw e;
    }

    // If we get here, PROPFIND worked but returned no data (or not MULTI_STATUS)
    // Try HEAD request as fallback if enabled
    if (useGetFallback) {
      return await this._getFileMetaViaHead(fullPath);
    }

    throw new RemoteFileNotFoundAPIError(path);
  }

  async download({ path }: { path: string }): Promise<{
    rev: string;
    legacyRev?: string;
    dataStr: string;
    lastModified?: string;
  }> {
    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
      const response = await this._makeRequest({
        url: fullPath,
        method: WebDavHttpMethod.GET,
      });

      // Guard against empty response body (e.g. CapacitorHttp on some Android providers)
      if (!response.data || response.data.length === 0) {
        throw new InvalidDataSPError(
          `Download of ${path} returned empty response body (HTTP ${response.status}).`,
        );
      }

      // Validate it's not an HTML error page
      this.xmlParser.validateResponseContent(
        response.data,
        path,
        'download',
        'file content',
      );

      // Get revision from Last-Modified
      let lastModified =
        response.headers['last-modified'] || response.headers['Last-Modified'];

      // Get ETag for legacy compatibility
      const etagHeader = response.headers['etag'] || response.headers['ETag'];
      let legacyRev = etagHeader ? this._cleanRev(etagHeader) : undefined;

      let rev = lastModified || '';
      const isLastModifiedMissing = !lastModified;
      const isLegacyRevMissing = !legacyRev;

      // Fallback: Some servers may omit Last-Modified on GET, so request metadata separately
      if (isLastModifiedMissing) {
        SyncLog.verbose(
          `${WebdavApi.L}.download() missing Last-Modified header, trying metadata fallback for ${path}`,
        );
        try {
          const meta = await this.getFileMeta(path, null, true);
          if (!lastModified && meta.lastmod) {
            lastModified = meta.lastmod;
            rev = lastModified;
          }
          if (isLegacyRevMissing) {
            const metaEtag = meta.data?.etag;
            if (metaEtag) {
              legacyRev = this._cleanRev(metaEtag);
            }
          }
        } catch (e) {
          SyncLog.warn(
            `${WebdavApi.L}.download() metadata fallback failed for ${path}`,
            e,
          );
        }
      }

      // Fallback to ETag if Last-Modified is still not available
      if (!rev && legacyRev) {
        rev = legacyRev;
        SyncLog.warn(
          `${WebdavApi.L}.download() no Last-Modified for ${path}, using ETag as revision.`,
        );
      }

      if (!rev) {
        SyncLog.err(
          `${WebdavApi.L}.download() no revision markers (Last-Modified or ETag) found for ${path}. ` +
            `Check your WebDAV server or reverse proxy configuration.`,
        );
        throw new NoRevAPIError(`No revision markers available for: ${path}`);
      }

      return {
        rev,
        legacyRev,
        dataStr: response.data,
        lastModified,
      };
    } catch (e) {
      SyncLog.error(`${WebdavApi.L}.download() error`, { path, error: e });
      throw e;
    }
  }

  async upload({
    path,
    data,
    expectedRev,
    isForceOverwrite = false,
  }: {
    path: string;
    data: string;
    expectedRev?: string | null;
    isForceOverwrite?: boolean;
  }): Promise<{ rev: string; legacyRev?: string; lastModified?: string }> {
    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
      // Prepare headers for upload
      const headers: Record<string, string> = {
        [WebDavHttpHeader.CONTENT_TYPE]: 'application/octet-stream',
      };

      // Set conditional headers based on revision type
      if (!isForceOverwrite && expectedRev) {
        // Try to parse as date first
        const parsedDate = new Date(expectedRev);
        if (isNaN(parsedDate.getTime())) {
          // Not a valid date - treat as ETag and use If-Match header
          // ETags should be quoted per RFC 7232
          const quotedEtag = expectedRev.startsWith('"')
            ? expectedRev
            : `"${expectedRev}"`;
          headers[WebDavHttpHeader.IF_MATCH] = quotedEtag;
          Log.verbose(WebdavApi.L, 'Using If-Match with ETag', quotedEtag);
        } else {
          // Valid date - use If-Unmodified-Since header
          // Add 1 second buffer to handle sub-second filesystem precision differences.
          // Some WebDAV servers store mtimes with millisecond precision but HTTP headers
          // only support second-level precision, causing false 412 Precondition Failed errors.
          // See: https://github.com/super-productivity/super-productivity/issues/6218
          const bufferedDate = new Date(parsedDate.getTime() + 1000);
          headers[WebDavHttpHeader.IF_UNMODIFIED_SINCE] = bufferedDate.toUTCString();
          Log.verbose(
            WebdavApi.L,
            'Using If-Unmodified-Since (with 1s buffer)',
            bufferedDate.toUTCString(),
          );
        }
      }

      // Try to upload the file
      let response: WebDavHttpResponse;
      try {
        response = await this._makeRequest({
          url: fullPath,
          method: WebDavHttpMethod.PUT,
          body: data,
          headers,
        });
      } catch (uploadError) {
        // Check for 412 Precondition Failed - means file was modified
        if (
          uploadError instanceof HttpNotOkAPIError &&
          uploadError.response &&
          uploadError.response.status === WebDavHttpStatus.PRECONDITION_FAILED
        ) {
          throw new RemoteFileChangedUnexpectedly(
            `File ${path} was modified on remote (expected rev: ${expectedRev})`,
          );
        }

        if (
          // if we get a 404 on upload this also indicates that the directory does not exist (for nextcloud)
          uploadError instanceof RemoteFileNotFoundAPIError ||
          (uploadError instanceof HttpNotOkAPIError &&
            uploadError.response &&
            // If we get a 409 Conflict, it might be because parent directory doesn't exist
            uploadError.response.status === WebDavHttpStatus.CONFLICT)
        ) {
          SyncLog.debug(
            `${WebdavApi.L}.upload() got 409 Conflict for ${fullPath}. ` +
              `This often indicates the sync folder path is misconfigured. ` +
              `Attempting to create parent directory...`,
          );

          // Try to create parent directory
          await this._ensureParentDirectory(fullPath);

          // Retry the upload
          try {
            response = await this._makeRequest({
              url: fullPath,
              method: WebDavHttpMethod.PUT,
              body: data,
              headers,
            });
          } catch (retryError) {
            // If retry also fails with 409, log a helpful error message
            if (
              retryError instanceof HttpNotOkAPIError &&
              retryError.response &&
              retryError.response.status === WebDavHttpStatus.CONFLICT
            ) {
              SyncLog.err(
                `${WebdavApi.L}.upload() 409 Conflict persists for ${fullPath} after creating parent directory. ` +
                  `Verify your syncFolderPath is relative to the WebDAV server root, ` +
                  `not your server's internal directory path.`,
              );
            }
            throw retryError;
          }
        } else {
          throw uploadError;
        }
      }

      // Get the new revision from Last-Modified
      const lastModified =
        response.headers['last-modified'] || response.headers['Last-Modified'];

      // Get ETag for legacy compatibility
      const etag = response.headers['etag'] || response.headers['ETag'];
      const legacyRev = etag ? this._cleanRev(etag) : undefined;

      let rev = lastModified || '';

      if (!rev) {
        // Some WebDAV servers don't return Last-Modified on PUT
        // Try to get it from a HEAD request first (cheaper than PROPFIND)
        SyncLog.verbose(
          `${WebdavApi.L}.upload() no Last-Modified in PUT response, fetching via HEAD`,
        );
        try {
          const headResponse = await this._makeRequest({
            url: fullPath,
            method: WebDavHttpMethod.HEAD,
          });
          const headLastMod =
            headResponse.headers['last-modified'] ||
            headResponse.headers['Last-Modified'];
          rev = headLastMod || '';

          if (rev) {
            // Try to get ETag from HEAD response for legacy compatibility
            const headEtag = headResponse.headers['etag'] || headResponse.headers['ETag'];
            const headLegacyRev = headEtag ? this._cleanRev(headEtag) : undefined;
            return { rev, legacyRev: headLegacyRev, lastModified: rev };
          }
        } catch (headError) {
          SyncLog.verbose(
            `${WebdavApi.L}.upload() HEAD request failed, falling back to PROPFIND`,
            headError,
          );
        }

        // If HEAD didn't work, fall back to PROPFIND
        const meta = await this.getFileMeta(path, null, true);
        // Extract original ETag from meta.data if available
        const metaEtag = meta.data?.etag;
        const metaLegacyRev = metaEtag ? this._cleanRev(metaEtag) : undefined;
        return {
          rev: meta.lastmod,
          legacyRev: metaLegacyRev,
          lastModified: meta.lastmod,
        };
      }

      return { rev, legacyRev, lastModified };
    } catch (e) {
      SyncLog.error(`${WebdavApi.L}.upload() error`, { path, error: e });
      throw e;
    }
  }

  async remove(path: string, expectedRev?: string): Promise<void> {
    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
      const headers: Record<string, string> = {};

      if (expectedRev) {
        // Try to parse as date for If-Unmodified-Since
        const parsedDate = new Date(expectedRev);
        if (!isNaN(parsedDate.getTime())) {
          // Add 1 second buffer to handle sub-second filesystem precision differences.
          // See: https://github.com/super-productivity/super-productivity/issues/6218
          const bufferedDate = new Date(parsedDate.getTime() + 1000);
          headers[WebDavHttpHeader.IF_UNMODIFIED_SINCE] = bufferedDate.toUTCString();
        }
      }

      await this._makeRequest({
        url: fullPath,
        method: WebDavHttpMethod.DELETE,
        headers,
      });

      SyncLog.verbose(`${WebdavApi.L}.remove() success for ${path}`);
    } catch (e) {
      SyncLog.error(`${WebdavApi.L}.remove() error`, { path, error: e });
      throw e;
    }
  }

  async testConnection(
    cfg: WebdavPrivateCfg,
  ): Promise<{ success: boolean; error?: string; fullUrl: string }> {
    const fullPath = this._buildFullPath(cfg.baseUrl, cfg.syncFolderPath || '/');
    SyncLog.verbose(`${WebdavApi.L}.testConnection() testing ${fullPath}`);

    try {
      // Build authorization header
      const auth = btoa(`${cfg.userName}:${cfg.password}`);
      const headers = {
        [WebDavHttpHeader.AUTHORIZATION]: `Basic ${auth}`,
        [WebDavHttpHeader.CONTENT_TYPE]: 'application/xml; charset=utf-8',
        [WebDavHttpHeader.DEPTH]: '0',
      };

      // Try PROPFIND on the sync folder path
      const response = await this.httpAdapter.request({
        url: fullPath,
        method: WebDavHttpMethod.PROPFIND,
        headers,
        body: WebdavXmlParser.PROPFIND_XML,
      });

      if (
        response.status === WebDavHttpStatus.MULTI_STATUS ||
        response.status === WebDavHttpStatus.OK
      ) {
        SyncLog.verbose(`${WebdavApi.L}.testConnection() success for ${fullPath}`);
        return { success: true, fullUrl: fullPath };
      }

      return {
        success: false,
        error: `Unexpected status ${response.status}`,
        fullUrl: fullPath,
      };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      SyncLog.warn(`${WebdavApi.L}.testConnection() failed for ${fullPath}`, e);
      return { success: false, error: errorMessage, fullUrl: fullPath };
    }
  }

  /**
   * Tests if the WebDAV server properly supports If-Unmodified-Since conditional headers.
   *
   * This method:
   * 1. Uploads a test file
   * 2. Gets its last-modified timestamp
   * 3. Tries to upload again with an old If-Unmodified-Since date (1 day before)
   * 4. If the upload succeeds (when it should fail with 412), headers are NOT supported
   * 5. If the upload fails with 412 Precondition Failed, headers ARE supported
   *
   * @param testPath - Path where the test file will be created (will be cleaned up)
   * @returns true if conditional headers are properly supported, false otherwise
   */
  async testConditionalHeaders(testPath: string): Promise<boolean> {
    const testContent = `test-${Date.now()}`;
    SyncLog.normal(
      `${WebdavApi.L}.testConditionalHeaders() testing with path: ${testPath}`,
    );

    try {
      // Step 1: Upload test file (force overwrite to ensure it gets created)
      await this.upload({
        path: testPath,
        data: testContent,
        isForceOverwrite: true,
      });

      // Step 2: Get its timestamp
      const meta = await this.getFileMeta(testPath, null, true);
      const currentRev = meta.lastmod;

      if (!currentRev) {
        SyncLog.warn(
          `${WebdavApi.L}.testConditionalHeaders() Server did not return lastmod - cannot test conditional headers`,
        );
        return false;
      }

      // Step 3: Try to upload with an OLD If-Unmodified-Since (1 day before)
      const oldDate = new Date(new Date(currentRev).getTime() - 86400000).toUTCString();
      try {
        await this.upload({
          path: testPath,
          data: testContent + '-v2',
          expectedRev: oldDate,
        });
        // Upload succeeded when it should have failed with 412
        SyncLog.warn(
          `${WebdavApi.L}.testConditionalHeaders() Server ignored If-Unmodified-Since header - conditional headers NOT supported`,
        );
        return false; // Headers NOT supported
      } catch (e) {
        if (e instanceof RemoteFileChangedUnexpectedly) {
          SyncLog.normal(
            `${WebdavApi.L}.testConditionalHeaders() Server properly returned 412 - conditional headers ARE supported`,
          );
          return true; // Headers ARE supported (got 412 as expected)
        }
        throw e; // Unexpected error
      }
    } finally {
      // Clean up test file
      try {
        await this.remove(testPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async _makeRequest({
    url,
    method,
    body = null,
    headers = {},
  }: {
    url: string;
    method: string;
    body?: string | null;
    headers?: Record<string, string>;
  }): Promise<WebDavHttpResponse> {
    const cfg = await this._getCfgOrError();

    // Build authorization header
    let authHeaderVal;
    if (cfg.accessToken) {
      authHeaderVal = `Bearer ${cfg.accessToken}`;
    } else {
      const auth = btoa(`${cfg.userName}:${cfg.password}`);
      authHeaderVal = `Basic ${auth}`;
    }

    const allHeaders = {
      [WebDavHttpHeader.AUTHORIZATION]: authHeaderVal,
      ...headers,
    };

    return await this.httpAdapter.request({
      url,
      method,
      headers: allHeaders,
      body,
    });
  }

  private async _ensureParentDirectory(fullPath: string): Promise<void> {
    const pathParts = fullPath.split('/');
    pathParts.pop(); // Remove filename
    const parentPath = pathParts.join('/');

    if (!parentPath || parentPath === fullPath) {
      return;
    }

    // Check if we're already creating this directory
    const existingPromise = this.directoryCreationQueue.get(parentPath);
    if (existingPromise) {
      SyncLog.verbose(
        `${WebdavApi.L}._ensureParentDirectory() waiting for existing creation of ${parentPath}`,
      );
      await existingPromise;
      return;
    }

    // Create a new promise for this directory
    const creationPromise = this._createDirectory(parentPath);
    this.directoryCreationQueue.set(parentPath, creationPromise);

    try {
      await creationPromise;
    } finally {
      // Clean up the queue
      this.directoryCreationQueue.delete(parentPath);
    }
  }

  private async _createDirectory(path: string): Promise<void> {
    try {
      // Try to create directory
      await this._makeRequest({
        url: path,
        method: WebDavHttpMethod.MKCOL,
      });
      SyncLog.verbose(`${WebdavApi.L}._createDirectory() created ${path}`);
    } catch (e) {
      // Check if error is due to directory already existing (405 Method Not Allowed or 409 Conflict)
      if (
        e instanceof HttpNotOkAPIError &&
        e.response &&
        (e.response.status === WebDavHttpStatus.METHOD_NOT_ALLOWED || // Method not allowed - directory exists
          e.response.status === WebDavHttpStatus.CONFLICT || // Conflict - parent doesn't exist
          e.response.status === WebDavHttpStatus.MOVED_PERMANENTLY || // Moved permanently - directory exists
          e.response.status === WebDavHttpStatus.OK) // OK - directory exists
      ) {
        SyncLog.verbose(
          `${WebdavApi.L}._createDirectory() directory likely exists: ${path} (status: ${e.response.status})`,
        );
      } else {
        // Log other errors but don't throw - we'll let the actual upload fail if needed
        SyncLog.warn(`${WebdavApi.L}._createDirectory() unexpected error for ${path}`, e);
      }
    }
  }

  private _buildFullPath(baseUrl: string | null | undefined, path: string): string {
    // Validate baseUrl is present - this can be null/undefined if WebDAV config is incomplete
    if (!baseUrl) {
      throw new MissingCredentialsSPError(
        'WebDAV base URL is not configured. Please check your sync settings.',
      );
    }

    // Validate path to prevent directory traversal attacks
    if (path.includes('..') || path.includes('//')) {
      throw new Error(
        `Invalid path: ${path}. Path cannot contain '..' or '//' sequences`,
      );
    }

    try {
      // We need to robustly handle various combinations of encoded/unencoded baseUrls and paths,
      // especially for providers like Mailbox.org that include spaces in the user's path.
      // We also want to avoid double-encoding if the path is already encoded.
      // See: https://github.com/super-productivity/super-productivity/issues/5508
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch (e) {
        // Try to fix the base URL if it failed (likely due to spaces)
        // We manually replace spaces to avoid messing up existing encoded characters (like %2F)
        // which can happen with decodeURI/encodeURI roundtrips.
        const fixedBase = baseUrl.replace(/ /g, '%20');
        url = new URL(fixedBase);
      }

      // Remove trailing slash from base
      const base = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
      // Remove leading slash from path
      const append = path.startsWith('/') ? path.substring(1) : path;

      // Assigning to pathname handles encoding of unencoded characters (spaces)
      // while preserving already encoded sequences.
      url.pathname = `${base}/${append}`;
      return url.href;
    } catch (e) {
      // Fallback for invalid Base URL (e.g. no protocol)
      // Encode path/base segments while avoiding double-encoding
      const cleanBase = baseUrl.replace(/\/$/, '');
      const cleanPath = path.startsWith('/') ? path : `/${path}`;

      const encodeSegment = (segment: string): string => {
        if (!segment) {
          return segment;
        }
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch {
          return encodeURIComponent(segment);
        }
      };

      // Separate protocol to avoid collapsing the double slashes
      const protocolMatch = cleanBase.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/);
      const protocol = protocolMatch ? protocolMatch[1] : '';
      const baseWithoutProtocol = protocolMatch ? protocolMatch[2] : cleanBase;

      const normalizedBase = baseWithoutProtocol
        .split('/')
        .filter((s, idx, arr) => !(idx === arr.length - 1 && s === ''))
        .map(encodeSegment)
        .join('/');
      const normalizedPath = cleanPath.split('/').map(encodeSegment).join('/');

      return `${protocol}${normalizedBase}${normalizedPath}`;
    }
  }

  private _cleanRev(rev: string): string {
    // Clean ETag values for legacy compatibility
    // Remove quotes, slashes, and HTML entities
    if (!rev) return '';
    return rev
      .replace(/"/g, '')
      .replace(/\//g, '')
      .replace(/&quot;/g, '')
      .trim();
  }

  private async _getFileMetaViaHead(fullPath: string): Promise<FileMeta> {
    const response = await this._makeRequest({
      url: fullPath,
      method: WebDavHttpMethod.HEAD,
    });

    // Safely access headers with null checks
    const headers = response.headers || {};
    const lastModified = headers['last-modified'] || headers['Last-Modified'] || '';
    const contentLength = headers['content-length'] || headers['Content-Length'] || '0';
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    const etag = headers['etag'] || headers['ETag'] || '';

    // Determine effective lastmod: prefer Last-Modified, fall back to ETag
    let effectiveLastmod = lastModified;
    if (!lastModified && etag) {
      effectiveLastmod = this._cleanRev(etag);
      SyncLog.warn(
        `${WebdavApi.L}._getFileMetaViaHead() No Last-Modified header for ${fullPath}, using ETag as revision. ` +
          `This may indicate a reverse proxy or server configuration issue.`,
      );
    }

    if (!effectiveLastmod) {
      throw new InvalidDataSPError(
        `No Last-Modified or ETag headers in HEAD response for ${fullPath}. ` +
          `Your WebDAV server or reverse proxy may be stripping headers. ` +
          `Check server configuration or reverse proxy header forwarding settings.`,
      );
    }

    // Extract filename from path
    const filename = fullPath.split('/').pop() || '';

    // Safely parse content length with validation
    let size = 0;
    try {
      const parsedSize = parseInt(contentLength, 10);
      if (!isNaN(parsedSize) && parsedSize >= 0) {
        size = parsedSize;
      }
    } catch (e) {
      SyncLog.warn(
        `${WebdavApi.L}._getFileMetaViaHead() invalid content-length: ${contentLength}`,
      );
    }

    return {
      filename,
      basename: filename,
      lastmod: effectiveLastmod,
      size,
      type: contentType || 'application/octet-stream',
      etag: effectiveLastmod, // Use effective lastmod for consistency
      data: {
        /* eslint-disable @typescript-eslint/naming-convention */
        'content-type': contentType,
        'content-length': contentLength,
        'last-modified': effectiveLastmod,
        /* eslint-enable @typescript-eslint/naming-convention */
        etag: etag,
        href: fullPath,
      },
      path: fullPath,
    };
  }
}
