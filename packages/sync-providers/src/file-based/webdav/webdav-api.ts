import type { SyncLogger } from '@sp/sync-core';
import {
  EmptyRemoteBodySPError,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
  WebDavSyncFolderUnusableSPError,
} from '../../errors';
import { errorMeta } from '../../log/error-meta';
import { computeContentRev } from '../content-rev';
import { WebDavHttpHeader, WebDavHttpMethod, WebDavHttpStatus } from './webdav.const';
import type { WebDavHttpAdapter, WebDavHttpResponse } from './webdav-http-adapter';
import { FileMeta, WebdavXmlParser } from './webdav-xml-parser';
import type { WebdavPrivateCfg } from './webdav.model';

/**
 * RFC 7232 strong entity-tag: a quoted string of `etagc` chars only. The class
 * excludes CR/LF, all control chars, the inner quote, and DEL, so a value from
 * this pattern is safe to place verbatim in an `If-Match` header (no header
 * splitting). Weak tags (`W/"..."`) intentionally do not match — they cannot
 * drive a conditional write, so callers fall back to the content-hash check.
 */
const STRONG_ETAG_RE = /^"[\x21\x23-\x7e\x80-\xff]*"$/;

export interface WebdavApiDeps {
  logger: SyncLogger;
  /**
   * App-supplied factory for the current WebDAV cfg. Throws when
   * credentials are missing — the caller catches and converts to
   * `MissingCredentialsSPError`.
   */
  getCfg: () => Promise<WebdavPrivateCfg>;
  httpAdapter: WebDavHttpAdapter;
}

export class WebdavApi {
  private static readonly L = 'WebdavApi';
  private readonly xmlParser: WebdavXmlParser;
  private readonly directoryCreationQueue = new Map<string, Promise<void>>();

  constructor(private readonly _deps: WebdavApiDeps) {
    this.xmlParser = new WebdavXmlParser(_deps.logger);
  }

  private async _computeContentHash(data: string): Promise<string> {
    return computeContentRev(data);
  }

  /**
   * Returns an RFC-style strong entity tag from a response header. Weak or
   * malformed values cannot safely drive `If-Match`, so callers fall back to a
   * content hash and the legacy best-effort check instead.
   */
  private _readStrongEtag(headers: Record<string, string>): string | undefined {
    const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'etag');
    const etag = entry?.[1]?.trim();
    return etag && STRONG_ETAG_RE.test(etag) ? etag : undefined;
  }

  private _isStrongEtag(value: string): boolean {
    return STRONG_ETAG_RE.test(value);
  }

  private _isHttpStatus(error: unknown, status: number): boolean {
    return error instanceof HttpNotOkAPIError && error.response?.status === status;
  }

  private _remoteChanged(path: string): RemoteFileChangedUnexpectedly {
    return new RemoteFileChangedUnexpectedly(
      `File ${path} no longer matches the revision downloaded before this upload.`,
    );
  }

  // ==============================
  // File Operations
  // ==============================

  async listFiles(dirPath: string): Promise<string[]> {
    const cfg = await this._deps.getCfg();
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
      const safeStatus =
        response.status >= 200 && response.status <= 599 ? response.status : 500;
      const errorResponse = new Response(response.data, { status: safeStatus });
      throw new HttpNotOkAPIError(errorResponse);
    } catch (e) {
      // Handle "Not Found" error specifically to return empty array
      if (
        e instanceof HttpNotOkAPIError &&
        e.response?.status === WebDavHttpStatus.NOT_FOUND
      ) {
        return [];
      }
      this._deps.logger.critical(
        `${WebdavApi.L}.listFiles() error`,
        errorMeta(e, { dirPath }),
      );
      throw e;
    }
  }

  /**
   * Retrieve metadata for a file or folder via PROPFIND.
   * Used for testConnection() and listFiles(), not for revision tracking.
   */
  async getFileMeta(path: string): Promise<FileMeta> {
    const cfg = await this._deps.getCfg();
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
      this._deps.logger.critical(
        `${WebdavApi.L}.getFileMeta() error`,
        errorMeta(e, { path }),
      );
      throw e;
    }

    throw new RemoteFileNotFoundAPIError(path);
  }

  async download({ path }: { path: string }): Promise<{ rev: string; dataStr: string }> {
    const cfg = await this._deps.getCfg();
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

      const hash = await this._computeContentHash(response.data);
      return {
        rev: this._readStrongEtag(response.headers) ?? hash,
        dataStr: response.data,
      };
    } catch (e) {
      this._deps.logger.critical(
        `${WebdavApi.L}.download() error`,
        errorMeta(e, { path }),
      );
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
    if (!data || data.trim().length === 0) {
      throw new InvalidDataSPError(
        `Refusing to upload empty data to ${path}. This would overwrite the remote file with zero bytes.`,
      );
    }

    const cfg = await this._deps.getCfg();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);
    // Hash the local payload once. Reused as the `expectedHash` passed to
    // `_verifyUpload` so we never compute md5(data) twice per upload (saves
    // one WASM call on the ~MB sync file).
    const expectedHash = await this._computeContentHash(data);

    try {
      const strongExpectedRev =
        expectedRev && this._isStrongEtag(expectedRev) ? expectedRev : undefined;

      // Servers without a strong ETag retain the legacy content-hash check. This
      // detects stale writers but cannot close the GET→PUT race; strong ETags do
      // close it through the HTTP precondition attached to the PUT below.
      if (!isForceOverwrite && expectedRev && !strongExpectedRev) {
        try {
          const currentResponse = await this._makeRequest({
            url: fullPath,
            method: WebDavHttpMethod.GET,
          });
          const currentHash = await this._computeContentHash(currentResponse.data);
          if (currentHash !== expectedRev) {
            throw this._remoteChanged(path);
          }
        } catch (e) {
          // A revision was supplied, so disappearance is itself a conflicting
          // remote change. Proceeding would silently recreate over that change.
          if (e instanceof RemoteFileNotFoundAPIError) throw this._remoteChanged(path);
          throw e;
        }
      }

      const headers: Record<string, string> = {
        [WebDavHttpHeader.CONTENT_TYPE]: 'application/octet-stream',
      };
      if (!isForceOverwrite && strongExpectedRev) {
        headers[WebDavHttpHeader.IF_MATCH] = strongExpectedRev;
      } else if (!isForceOverwrite && expectedRev === null) {
        headers[WebDavHttpHeader.IF_NONE_MATCH] = '*';
      }

      // Try to upload the file
      try {
        await this._makeRequest({
          url: fullPath,
          method: WebDavHttpMethod.PUT,
          body: data,
          headers,
        });
      } catch (uploadError) {
        if (this._isHttpStatus(uploadError, WebDavHttpStatus.PRECONDITION_FAILED)) {
          throw this._remoteChanged(path);
        }
        if (uploadError instanceof RemoteFileNotFoundAPIError && expectedRev !== null) {
          throw this._remoteChanged(path);
        }
        if (
          // 404 on upload indicates the directory does not exist (Nextcloud)
          uploadError instanceof RemoteFileNotFoundAPIError ||
          (uploadError instanceof HttpNotOkAPIError &&
            uploadError.response &&
            // 409 Conflict — parent directory doesn't exist
            uploadError.response.status === WebDavHttpStatus.CONFLICT)
        ) {
          this._deps.logger.normal(
            `${WebdavApi.L}.upload() got 404/409 — creating parent directory`,
            { path },
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
            if (this._isHttpStatus(retryError, WebDavHttpStatus.PRECONDITION_FAILED)) {
              throw this._remoteChanged(path);
            }
            if (
              retryError instanceof HttpNotOkAPIError &&
              retryError.response &&
              retryError.response.status === WebDavHttpStatus.CONFLICT
            ) {
              // Demoted from `critical` to `normal`: this is a config-debug
              // hint, not an exceptional / unrecoverable condition.
              this._deps.logger.normal(
                `${WebdavApi.L}.upload() 409 Conflict persists after creating parent. ` +
                  `Verify syncFolderPath is relative to the WebDAV server root.`,
                { path },
              );
              // Re-throw as an actionable, privacy-safe error so the user
              // sees *why* sync fails (misconfigured Base URL / Sync Folder
              // Path) instead of a bare "HTTP 409 Conflict". The raw 409 is
              // already captured by the logger.normal() call above.
              throw new WebDavSyncFolderUnusableSPError();
            }
            throw retryError;
          }
        } else {
          throw uploadError;
        }
      }

      const verifiedRev = await this._verifyUpload(path, fullPath, expectedHash);
      return { rev: verifiedRev };
    } catch (e) {
      this._deps.logger.critical(`${WebdavApi.L}.upload() error`, errorMeta(e, { path }));
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

    const remoteHash = await this._computeContentHash(remoteResponse.data);
    if (remoteHash !== expectedHash) {
      throw new RemoteFileChangedUnexpectedly(
        `Upload verification of ${path} failed: remote content hash differs ` +
          `from uploaded data. Either the server stored a truncated copy, or ` +
          `a concurrent write landed between PUT and verification. The next ` +
          `sync cycle will re-download and reconcile.`,
      );
    }
    return this._readStrongEtag(remoteResponse.headers) ?? remoteHash;
  }

  async remove(path: string): Promise<void> {
    const cfg = await this._deps.getCfg();
    const fullPath = this._buildFullPath(cfg.baseUrl, path);

    try {
      await this._makeRequest({
        url: fullPath,
        method: WebDavHttpMethod.DELETE,
      });
      this._deps.logger.normal(`${WebdavApi.L}.remove() success`, { path });
    } catch (e) {
      this._deps.logger.critical(`${WebdavApi.L}.remove() error`, errorMeta(e, { path }));
      throw e;
    }
  }

  /**
   * Try a PROPFIND against the WebDAV base root to verify the cfg works
   * end-to-end. The configured sync folder is intentionally NOT probed —
   * it is created lazily on the first upload and would 404 on first-time
   * setup (see issue #7617). Returns a normalized result that the dialog
   * surfaces directly to the user; `fullUrl` is the configured sync
   * folder (where data will sync), not the probed root.
   *
   * The privacy invariant lives in the logger call below (structured
   * `errorMeta`, no raw error object). The returned `fullUrl` / `error`
   * are intentionally human-readable — the user is testing their own
   * server config and needs the original URL + a meaningful failure
   * message in the snackbar. Callers must NOT route this return value
   * through `OpLog` / exportable logs.
   */
  async testConnection(
    cfg: WebdavPrivateCfg,
  ): Promise<{ success: boolean; error?: string; fullUrl: string; errorCode?: number }> {
    const fullPath = this._buildFullPath(cfg.baseUrl, cfg.syncFolderPath || '/');

    try {
      const auth = btoa(`${cfg.userName}:${cfg.password}`);
      const headers = {
        [WebDavHttpHeader.AUTHORIZATION]: `Basic ${auth}`,
        [WebDavHttpHeader.CONTENT_TYPE]: 'application/xml; charset=utf-8',
        [WebDavHttpHeader.DEPTH]: '0',
      };

      // Probe the base root (see JSDoc / issue #7617). This still fails
      // correctly for broken configs: a wrong username / base path makes
      // the root itself 404, and a bad password makes it 401 — both
      // propagate out of the adapter and into the catch below.
      const response = await this._deps.httpAdapter.request({
        url: this._buildFullPath(cfg.baseUrl, '/'),
        method: WebDavHttpMethod.PROPFIND,
        headers,
        body: WebdavXmlParser.PROPFIND_XML,
      });

      if (
        response.status === WebDavHttpStatus.MULTI_STATUS ||
        response.status === WebDavHttpStatus.OK
      ) {
        return { success: true, fullUrl: fullPath };
      }

      return {
        success: false,
        error: `Unexpected status ${response.status}`,
        fullUrl: fullPath,
        errorCode: response.status,
      };
    } catch (e) {
      // testConnection is user-initiated and failure is the expected
      // outcome of a misconfig retry loop. Log at `normal`, not
      // `critical`, so the exportable log isn't dominated by
      // configuration debugging.
      this._deps.logger.normal(`${WebdavApi.L}.testConnection() failed`, errorMeta(e));
      const { message, errorCode } = WebdavApi._describeTestError(e);
      return { success: false, error: message, fullUrl: fullPath, errorCode };
    }
  }

  /**
   * Map a thrown WebDAV error to a readable, privacy-safe message for the
   * "Test connection" UI. The only case that needs remapping is the
   * base-root 404 (issue #7617): `RemoteFileNotFoundAPIError`'s message is
   * the bare scrubbed host, which read as a cryptic error and led users to
   * misdiagnose their config. It is replaced with a readable string and
   * tagged with `errorCode: 404` — the single discriminator the dialog
   * branches on to show the Nextcloud "Username is your user ID" hint.
   *
   * Every other error already has a readable, privacy-safe `.message`
   * (e.g. `HttpNotOkAPIError.message` is `HTTP <status> <statusText>`,
   * never the `.detail` body which can carry filenames; `AuthFailSPError`
   * is "Authentication failed (HTTP 401)"), so they pass through unchanged.
   * Callers must keep this UI-only and never route it to a structured logger.
   */
  private static _describeTestError(e: unknown): { message: string; errorCode?: number } {
    if (e instanceof RemoteFileNotFoundAPIError) {
      return {
        message:
          'Not found (HTTP 404): no folder exists at this WebDAV path. ' +
          'Check the Base URL.',
        errorCode: WebDavHttpStatus.NOT_FOUND,
      };
    }
    if (e instanceof Error) {
      return { message: e.message };
    }
    return { message: 'Unknown error occurred' };
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
    const cfg = await this._deps.getCfg();

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

    return this._deps.httpAdapter.request({
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

  private async _createDirectory(fullPath: string): Promise<void> {
    try {
      await this._makeRequest({
        url: fullPath,
        method: WebDavHttpMethod.MKCOL,
      });
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
        // Expected when the directory already exists. No-op.
        return;
      }
      // Re-throw unexpected errors (e.g. 403 Permission Denied) so the caller
      // sees the real cause instead of a confusing follow-up error.
      // Demoted from `critical` to `normal`: a 403 / 5xx on MKCOL is a
      // recoverable config-or-network condition, not an unrecoverable
      // engine failure. The caller logs the thrown error at its catch
      // site (which uses `errorMeta`).
      this._deps.logger.normal(
        `${WebdavApi.L}._createDirectory() unexpected error`,
        errorMeta(e),
      );
      throw e;
    }
  }

  private _buildFullPath(baseUrl: string | null | undefined, path: string): string {
    // Validate baseUrl is present - this can be null/undefined if WebDAV config is incomplete
    if (!baseUrl) {
      throw new MissingCredentialsSPError(
        'WebDAV base URL is not configured. Please check your sync settings.',
      );
    }

    // Validate path to prevent directory traversal attacks. Use a generic
    // "Invalid path" so the message does not echo a user-derived path
    // segment into logs.
    if (path.includes('..') || path.includes('//')) {
      throw new InvalidDataSPError("Invalid sync path: contains '..' or '//' sequences.");
    }

    try {
      // We need to robustly handle various combinations of encoded/unencoded baseUrls and paths,
      // especially for providers like Mailbox.org that include spaces in the user's path.
      // We also want to avoid double-encoding if the path is already encoded.
      // See: https://github.com/super-productivity/super-productivity/issues/5508
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch {
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
    } catch {
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
