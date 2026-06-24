/**
 * Encode/decode for the SQLite `value` column — Stage 2 of the op-log perf work
 * (see docs/sync-and-op-log/sqlite-oplog-durability-and-perf-findings.md).
 *
 * WHY: on the native backend every read crosses the JS↔native bridge, where the
 * plugin serializes the result to a JSON string and JS `JSON.parse`s it. For the
 * multi-MB state-cache snapshot the op-log reads on every boot, that text — and
 * the bridge's re-escaping of it — is the dominant cost. Gzipping the value at
 * rest shrinks what crosses the bridge several-fold.
 *
 * SCOPE: this is a purely LOCAL, per-device storage-at-rest encoding. Nothing
 * above the adapter ever sees it — the adapter decodes back to the plain object
 * before the value reaches sync/hydration — so it is NOT a sync/cross-client
 * format and carries no forward/back-compat obligation to other clients. Only the
 * SQLite backend uses it; IndexedDB stores native objects (no JSON, no codec).
 *
 * SELF-GATING: only values above {@link COMPRESS_THRESHOLD_BYTES} are compressed.
 * Small rows (every op, tiny snapshots) stay plain JSON — no CPU/marker overhead
 * and no behavior change — so this is safe regardless of a given install's real
 * snapshot size; it only ever helps the large-blob case.
 *
 * FORMAT: a compressed value is `MARKER + base64(gzip(utf8(json)))`; an
 * uncompressed value is the plain JSON text. {@link decodeValue} dispatches on the
 * marker, so plain rows written before this existed (and small rows written now)
 * read back unchanged — making the change reversible (stop compressing → new
 * writes are plain → reads still handle both). The marker starts with `~`, which
 * `JSON.stringify` output never does (it begins with `{ [ " -` digit / t / f / n),
 * so it can never collide with a plain value.
 */
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

/** Versioned, NUL-free, non-JSON-leading sentinel that prefixes a compressed value. */
const MARKER = '~gz1:';

/**
 * Only compress values larger than this (UTF-16 char count, a cheap proxy for
 * size). Below it the gzip CPU + base64 overhead isn't worth it and the bridge
 * cost is already negligible — so ops and small snapshots stay plain JSON.
 */
export const COMPRESS_THRESHOLD_BYTES = 2048;

/** Chunked so the spread never exceeds the JS argument limit on a multi-MB blob. */
const u8ToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const base64ToU8 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

/** Serialize `value` for the `value` column, gzip-compressing it when large. */
export const encodeValue = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (json.length <= COMPRESS_THRESHOLD_BYTES) {
    return json;
  }
  const compressed = MARKER + u8ToBase64(gzipSync(strToU8(json)));
  // Monotonic: poorly-compressible content (random IDs, embedded base64, encrypted
  // sub-blobs) can gzip to nearly its original size, and base64's ~33% inflation
  // then makes the encoded form LARGER than plain JSON. Keep whichever is smaller so
  // this can never grow a row (or the bytes crossing the bridge) — `decodeValue`
  // dispatches on the marker, so the plain fallback reads back fine.
  return compressed.length < json.length ? compressed : json;
};

/** Inverse of {@link encodeValue}; transparently handles plain (unmarked) rows. */
export const decodeValue = (raw: string): unknown => {
  if (raw.startsWith(MARKER)) {
    return JSON.parse(strFromU8(gunzipSync(base64ToU8(raw.slice(MARKER.length)))));
  }
  return JSON.parse(raw);
};
