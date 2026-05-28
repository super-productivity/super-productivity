import { compressWithGzipToString } from '../../op-log/encryption/compression-handler';
import { MAX_PLUGIN_DATA_SIZE } from '../plugin-persistence.model';

/**
 * Transparent compression for plugin user data on the way to/from the
 * op-log. Plugins call `persistDataSynced(string)` / `loadSyncedData(): string`
 * and only ever see the string they themselves wrote; the host wraps the
 * payload with gzip+base64 between the plugin API and `PluginUserData.data`,
 * so every op (and every sync upload) carries the compressed form.
 *
 * Format: `GZ1:<base64-gzip-bytes>`. The `GZ1:` sentinel doubles as a version
 * tag — future format changes get a new prefix and stay decodable alongside.
 *
 * Below `COMPRESS_THRESHOLD` we emit the input unchanged. Gzip's framing
 * (~18 bytes) plus base64's 4/3 overhead actively hurts very small payloads,
 * and most plugin-metadata-style writes fall under the threshold.
 *
 * Backward compat on read: a string without the sentinel is treated as
 * legacy uncompressed data and passed through.
 *
 * Compression itself delegates to `@sp/sync-core` via the host's
 * `compression-handler` wrapper so we share the chunked base64 encoder,
 * env-shim detection, and error reporting with the op-log path.
 *
 * Decompression is intentionally **bounded** via three cheap-to-expensive
 * caps — `MAX_RAW_LENGTH` (pre-`atob`), `MAX_COMPRESSED_SIZE` (post-`atob`,
 * pre-stream), and `MAX_DECOMPRESSED_SIZE` (per-chunk in `gunzipBounded`) —
 * so a malicious gzip blob from a compromised sync server can't expand
 * into gigabytes and OOM the renderer. The write-side `MAX_PLUGIN_DATA_SIZE`
 * cap only constrains local input; remote data needs its own ceiling.
 */

export const SENTINEL = 'GZ1:';
export const COMPRESS_THRESHOLD = 1024;

/**
 * Decompression output cap. Plugins are write-bounded by
 * `MAX_PLUGIN_DATA_SIZE` (1 MB); allowing 2× on read covers any reasonable
 * round-trip while still bounding a gzip-bomb to a few MB of allocation.
 */
const MAX_DECOMPRESSED_SIZE = MAX_PLUGIN_DATA_SIZE * 2;

/**
 * Compressed input cap. Bounded at the same ceiling as the decompressed
 * output (2× write cap, ~2 MB) — generous enough to tolerate gzip framing
 * on near-incompressible payloads, tight enough to reject multi-MB attacks
 * before we hand bytes to `DecompressionStream`. Cheap defense-in-depth on
 * top of the per-chunk size check inside `gunzipBounded`.
 */
const MAX_COMPRESSED_SIZE = MAX_DECOMPRESSED_SIZE;

/**
 * Pre-decode cap on the raw (base64-encoded) string. base64 is 4 chars per
 * 3 source bytes, so a string longer than `MAX_COMPRESSED_SIZE * 2` chars
 * cannot fit under the byte cap. Checking before `atob` avoids allocating
 * the decoded Uint8Array for oversized attacker payloads.
 */
const MAX_RAW_LENGTH = MAX_COMPRESSED_SIZE * 2;

const TEXT_DECODER = new TextDecoder();

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * gzip-decompress a `Uint8Array` while enforcing an output-byte ceiling.
 * Reads the `DecompressionStream` chunk-by-chunk and aborts if the running
 * total exceeds `MAX_DECOMPRESSED_SIZE`, avoiding the gigabyte allocation
 * an unbounded `Response.arrayBuffer()` would produce.
 */
const gunzipBounded = async (bytes: Uint8Array): Promise<string> => {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_DECOMPRESSED_SIZE) {
        try {
          await reader.cancel();
        } catch {
          /* cancel is best-effort */
        }
        throw new Error(
          `Plugin data decompressed size exceeded ${MAX_DECOMPRESSED_SIZE} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* releaseLock is best-effort after cancel */
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return TEXT_DECODER.decode(out);
};

/**
 * Encode a plugin's persisted string for storage. Returns the input
 * unchanged below the compression threshold; otherwise gzip+base64 with
 * sentinel. Falls back to the raw input if compression throws — persistence
 * must never fail in this codec.
 */
export const encodeForPersist = async (input: string): Promise<string> => {
  if (input.length < COMPRESS_THRESHOLD) return input;
  try {
    return SENTINEL + (await compressWithGzipToString(input));
  } catch {
    return input;
  }
};

/**
 * Decode a stored value back to the original plugin string. Falls back to
 * pass-through for legacy uncompressed data (no sentinel).
 *
 * Throws on a malformed sentinel-prefixed blob *or* if the decompressed
 * output would exceed the size ceiling. Callers (the persistence service)
 * wrap and surface as a load failure.
 */
export const decodeFromPersist = async (raw: string): Promise<string> => {
  if (!raw.startsWith(SENTINEL)) return raw;
  const encoded = raw.slice(SENTINEL.length);
  // Reject before `atob` allocates a ~0.75 × encoded.length byte array.
  if (encoded.length > MAX_RAW_LENGTH) {
    throw new Error(`Plugin data raw size exceeded ${MAX_RAW_LENGTH} chars`);
  }
  const compressed = base64ToBytes(encoded);
  if (compressed.length > MAX_COMPRESSED_SIZE) {
    throw new Error(`Plugin data compressed size exceeded ${MAX_COMPRESSED_SIZE} bytes`);
  }
  return gunzipBounded(compressed);
};
