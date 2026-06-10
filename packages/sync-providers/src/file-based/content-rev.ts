import { md5 } from 'hash-wasm';

/**
 * Compute the content-addressable revision (md5 hash) for a sync payload.
 *
 * Used by file-based providers (WebDAV, local-file) that have no
 * server-supplied revision and must derive one from the file contents.
 *
 * Callers are responsible for any wrapping in provider-specific API errors
 * (e.g. `FileHashCreationAPIError`) — this helper just forwards the
 * underlying `hash-wasm` rejection.
 */
export const computeContentRev = (content: string): Promise<string> => md5(content);
