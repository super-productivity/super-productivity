import { WebdavPrivateCfg } from './webdav.model';
import { SyncLog } from '../../../../core/log';
import { FileMeta, WebdavXmlParser } from './webdav-xml-parser';
import { WebDavHttpAdapter, WebDavHttpResponse } from './webdav-http-adapter';
import {
  EmptyRemoteBodySPError,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
} from '../../../core/errors/sync-errors';
import { WebDavHttpHeader, WebDavHttpMethod, WebDavHttpStatus } from './webdav.const';
import { md5HashSync } from '../../../../util/md5-hash';

export class WebdavApi {
  private static readonly L = 'WebdavApi';
  private xmlParser: WebdavXmlParser;
  private httpAdapter: WebDavHttpAdapter;
  private directoryCreationQueue = new Map<string, Promise<void>>();

  constructor(private _getCfgOrError: () => Promise<WebdavPrivateCfg>) {
    this.xmlParser = new WebdavXmlParser();
    this.httpAdapter = new WebDavHttpAdapter();
  }

  private _computeContentHash(data: string): string {
    return md5HashSync(data);
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
      // Ensure status is valid (200-599) for Response constructor
      const safeStatus =
        response.status >= 200 && response.status <= 599 ? response.status : 500;
      const errorResponse = new Response(response.data, {
        status: safeStatus,
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
   * Retrieve metadata for a file or folder via PROPFIND.
   * Used for testConnection() and listFiles(), not for revision tracking.
   */
  async getFileMeta(path: string): Promise<FileMeta> {
    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
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
          return files[0];
        }
      }
    } catch (e) {
      SyncLog.error(`${WebdavApi.L}.getFileMeta() error`, { path, error: e });
      throw e;
    }

    throw new RemoteFileNotFoundAPIError(path);
  }

  async download({ path }: { path: string }): Promise<{
    rev: string;
    dataStr: string;
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
        throw new EmptyRemoteBodySPError(
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

      return {
        rev: this._computeContentHash(response.data),
        dataStr: response.data,
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
  }): Promise<{ rev: string }> {
    // Guard against empty upload data — prevents overwriting remote file with zero bytes.
    // This can happen when the Capacitor bridge drops the payload on Android.
    // Symmetric with the download guard at the download() method.
    if (!data || data.trim().length === 0) {
      throw new InvalidDataSPError(
        `Refusing to upload empty data to ${path}. This would overwrite the remote file with zero bytes.`,
      );
    }

    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
      // Application-level conflict detection: download current file and compare hash
      if (!isForceOverwrite && expectedRev) {
        try {
          const currentResponse = await this._makeRequest({
            url: fullPath,
            method: WebDavHttpMethod.GET,
          });
          const currentHash = this._computeContentHash(currentResponse.data);
          if (currentHash !== expectedRev) {
            throw new RemoteFileChangedUnexpectedly(
              `File ${path} was modified on remote (expected rev: ${expectedRev}, got: ${currentHash})`,
            );
          }
        } catch (e) {
          // 404 means file doesn't exist yet — safe to proceed with upload
          if (!(e instanceof RemoteFileNotFoundAPIError)) {
            throw e;
          }
        }
      }

      const headers: Record<string, string> = {
        [WebDavHttpHeader.CONTENT_TYPE]: 'application/octet-stream',
      };

      // Try to upload the file
      try {
        await this._makeRequest({
          url: fullPath,
          method: WebDavHttpMethod.PUT,
          body: data,
          headers,
        });
      } catch (uploadError) {
        if (
          // 404 on upload indicates the directory does not exist (Nextcloud)
          uploadError instanceof RemoteFileNotFoundAPIError ||
          (uploadError instanceof HttpNotOkAPIError &&
            uploadError.response &&
            // 409 Conflict — parent directory doesn't exist
            uploadError.response.status === WebDavHttpStatus.CONFLICT)
        ) {
          SyncLog.debug(
            `${WebdavApi.L}.upload() got 404/409 for ${fullPath}. ` +
              `Attempting to create parent directory...`,
          );

          // Try to create parent directory
          await this._ensureParentDirectory(fullPath);

          // Retry the upload
          try {
            await this._makeRequest({
              url: fullPath,
              method: WebDavHttpMethod.PUT,
              body: data,
              headers,
            });
          } catch (retryError) {
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

      const expectedHash = this._computeContentHash(data);
      const verifiedHash = await this._verifyUpload(path, fullPath, expectedHash);
      return { rev: verifiedHash };
    } catch (e) {
      SyncLog.error(`${WebdavApi.L}.upload() error`, { path, error: e });
      throw e;
    }
  }

  /**
   * Re-GETs the just-uploaded file and verifies its content hash matches what
   * we sent. Protects against silent truncation (e.g. flaky network, proxy
   * buffering, Nextcloud accepting a partial body) since WebDAV enforces no
   * integrity of its own. See issue #7300.
   *
   * A hash mismatch after a successful PUT is indistinguishable from a
   * concurrent write by another client landing in the same window. Both cases
   * are surfaced as RemoteFileChangedUnexpectedly so the adapter's existing
   * self-healing path (re-download and retry) handles them uniformly.
   */
  private async _verifyUpload(
    path: string,
    fullPath: string,
    expectedHash: string,
  ): Promise<string> {
    const remoteResponse = await this._makeRequest({
      url: fullPath,
      method: WebDavHttpMethod.GET,
      headers: {
        [WebDavHttpHeader.CACHE_CONTROL]: 'no-cache',
      },
    });

    if (!remoteResponse.data || remoteResponse.data.length === 0) {
      throw new EmptyRemoteBodySPError(
        `Post-upload verification of ${path} returned empty body.`,
      );
    }

    // Reject HTML error/login pages returned with 200 by proxies or
    // misconfigured auth — hashing them would misreport as corruption.
    this.xmlParser.validateResponseContent(
      remoteResponse.data,
      path,
      'upload-verify',
      'file content',
    );

    const remoteHash = this._computeContentHash(remoteResponse.data);
    if (remoteHash !== expectedHash) {
      throw new RemoteFileChangedUnexpectedly(
        `Upload verification of ${path} failed: remote content hash differs ` +
          `from uploaded data. Either the server stored a truncated copy, or ` +
          `a concurrent write landed between PUT and verification. The next ` +
          `sync cycle will re-download and reconcile.`,
      );
    }
    return remoteHash;
  }

  async remove(path: string): Promise<void> {
    const cfg = await this._getCfgOrError();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
      await this._makeRequest({
        url: fullPath,
        method: WebDavHttpMethod.DELETE,
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
        // Re-throw unexpected errors (e.g. 403 Permission Denied) so the caller
        // sees the real cause instead of a confusing follow-up error.
        SyncLog.warn(`${WebdavApi.L}._createDirectory() unexpected error for ${path}`, e);
        throw e;
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
}
