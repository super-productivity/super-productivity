import { UploadRevToMatchMismatchAPIError } from '../errors';

// Matches any non-ASCII UTF-16 code unit (≥ U+0080). For pure-ASCII strings the
// UTF-8 byte length equals String.length, so the on-wire byte count is known
// without encoding; for anything else it is transport-dependent.
const NON_ASCII = /[^\x00-\x7f]/;

/**
 * Detects a truncated/partial upload by comparing the byte size the remote
 * reports storing against the bytes we sent. File-based providers (Dropbox,
 * OneDrive) enforce no end-to-end integrity, so without this a cut-short body
 * (flaky network, buffering proxy) is silently accepted and the partial
 * gzip/JSON then fails to decode on every later download until the file is
 * deleted (#8604, #7300).
 *
 * A cheaper, truncation-focused analogue of WebDAV's content-hash
 * `_verifyUpload` (which re-GETs and catches any corruption). It reuses the
 * size already in the upload response — no extra request — but only catches
 * length-changing corruption, and only for pure-ASCII payloads (see below). It
 * DETECTS and fails the sync loudly so the bad write is not recorded as synced;
 * it does not repair the remote.
 *
 * @param data the exact string body that was uploaded
 * @param storedSize byte size the provider reports storing, or undefined if the
 *   response omits it (then skipped — fail open)
 * @param targetPath relative path, for the error message (privacy-safe)
 */
export const assertUploadedSizeMatches = (
  data: string,
  storedSize: number | undefined,
  targetPath: string,
): void => {
  // Fail open when size is absent — never block an upload on a check we can't
  // perform. In practice size ships alongside the rev/eTag the caller already
  // required, so this only guards a future "minimal response" API change.
  if (typeof storedSize !== 'number') {
    return;
  }
  // Only verifiable for pure-ASCII payloads: then the stored byte count equals
  // data.length on every transport (fetch UTF-8 and the native CapacitorHttp
  // path alike), so a mismatch unambiguously means truncation — and no
  // allocation is needed. Skip multi-byte payloads (default config ships
  // compression AND encryption OFF → raw JSON with non-ASCII task content): we
  // can't assume the native transport encodes byte-for-byte like TextEncoder,
  // and a wrong assumption would falsely loop (re-uploading every cycle).
  // Compressed/encrypted payloads are base64 (ASCII) — the #8604 case is covered.
  if (NON_ASCII.test(data)) {
    return;
  }
  if (storedSize !== data.length) {
    throw new UploadRevToMatchMismatchAPIError(
      `${targetPath}: remote stored ${storedSize} bytes but ${data.length} were ` +
        `uploaded — the remote copy is truncated. Sync will fail until a full ` +
        `copy is written.`,
    );
  }
};
