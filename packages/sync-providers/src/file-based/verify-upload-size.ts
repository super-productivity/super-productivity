import { UploadRevToMatchMismatchAPIError } from '../errors';

/** Reused for upload-size verification; avoids per-upload allocation. */
const TEXT_ENCODER = new TextEncoder();

/**
 * Detects a truncated/partial upload by comparing the byte size the remote
 * reports storing against the bytes we sent. File-based providers (Dropbox,
 * OneDrive) enforce no end-to-end integrity, so without this a cut-short body
 * (flaky network, buffering proxy) is silently accepted and the partial
 * gzip/JSON then fails to decode on every later download until the file is
 * deleted (#8604, #7300).
 *
 * Only compares for pure-ASCII payloads (byte count === char count): then the
 * stored size equals what we sent on every transport — fetch (UTF-8) and the
 * native CapacitorHttp path alike — so a mismatch unambiguously means
 * truncation. For multi-byte payloads (default config ships compression AND
 * encryption OFF → raw JSON with non-ASCII task content) we can't assume the
 * native transport encodes byte-for-byte like TextEncoder, and a wrong
 * assumption would falsely loop (re-uploading every cycle), so skip.
 * Compressed/encrypted payloads are base64 (ASCII) — the #8604 case is covered.
 *
 * This is a cheaper, truncation-focused analogue of WebDAV's content-hash
 * `_verifyUpload` (which re-GETs and catches any corruption). It reuses the
 * size already in the upload response — no extra request — but only catches
 * length-changing corruption. It DETECTS and fails the sync loudly so the bad
 * write is not recorded as synced; it does not repair the remote (the partial
 * file stays until a full copy overwrites it). Raised as
 * UploadRevToMatchMismatchAPIError — the error the upload path already surfaces.
 *
 * @param data the exact string body that was uploaded
 * @param storedSize byte size the provider reports having stored, or undefined
 *   when the response omits it (then the check is skipped — fail open)
 * @param targetPath relative path, for the error message (privacy-safe)
 */
export const assertUploadedSizeMatches = (
  data: string,
  storedSize: number | undefined,
  targetPath: string,
): void => {
  if (typeof storedSize !== 'number') {
    return;
  }
  const sentBytes = TEXT_ENCODER.encode(data).length;
  if (sentBytes !== data.length) {
    return;
  }
  if (storedSize !== sentBytes) {
    throw new UploadRevToMatchMismatchAPIError(
      `${targetPath}: remote stored ${storedSize} bytes but ${sentBytes} were ` +
        `uploaded — the remote copy is truncated. Sync will fail until a full ` +
        `copy is written.`,
    );
  }
};
