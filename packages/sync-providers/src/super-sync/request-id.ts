import type { SyncOperation } from '../provider-types';

/** Versioned prefix for the deterministic ops-upload `requestId`. */
export const OPS_UPLOAD_REQUEST_ID_PREFIX = 'ops-v1';

/** Versioned prefix for deterministic snapshot-upload `requestId`s. */
export const SNAPSHOT_UPLOAD_REQUEST_ID_PREFIX = 'snapshot-v1';

/**
 * Deterministic upload-batch identifier for server-side idempotency.
 * Lets the SuperSync server recognize a retried upload (e.g. after a
 * network drop between server commit and client receipt) and return
 * the cached result instead of rejecting as duplicate ops.
 *
 * The id is derived from `clientId` + a stable hash of the logical
 * ops batch. Encrypted payload bytes are deliberately excluded
 * because AES-GCM uses fresh IVs; retrying the same logical op can
 * produce different ciphertext.
 */
export const createOpsUploadRequestId = (
  ops: SyncOperation[],
  clientId: string,
): string => {
  const opIds = ops.map((op) => op.id).join('|');
  let opsFingerprint = opIds;
  try {
    opsFingerprint = stableJsonStringify(ops.map((op) => toRequestIdFingerprintOp(op)));
  } catch {
    opsFingerprint = opIds;
  }
  const firstOpId = compactRequestIdPart(ops[0]?.id ?? 'empty');
  const lastOp = ops.length > 0 ? ops[ops.length - 1] : undefined;
  const lastOpId = compactRequestIdPart(lastOp?.id ?? 'empty');
  const hash = hashRequestIdInput(`${clientId}|${opsFingerprint}`);
  return `${OPS_UPLOAD_REQUEST_ID_PREFIX}-${ops.length}-${firstOpId}-${lastOpId}-${hash}`;
};

/**
 * Deterministic dedup key for snapshot uploads. The server-side opId is a
 * UUID-v7 minted per snapshot upload, so retries reuse it and `(clientId, opId)`
 * uniquely identifies an attempt — no content hash needed. Stripping the
 * payload hash avoids two expensive passes (`stableJsonStringify` + char
 * scan) over a multi-MB state on mobile.
 */
export const createSnapshotUploadRequestId = (clientId: string, opId: string): string => {
  const compactClientId = compactRequestIdPart(clientId);
  const compactOpId = compactRequestIdPart(opId || 'snapshot');
  const hash = hashRequestIdInput(`${clientId}|${opId}`);
  return `${SNAPSHOT_UPLOAD_REQUEST_ID_PREFIX}-${compactClientId}-${compactOpId}-${hash}`;
};

const compactRequestIdPart = (id: string): string => {
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || 'x';
};

/**
 * Two-way FNV-1a-like hash (32-bit FNV + a second mixing pass) so
 * the resulting hex is wide enough for batch identification. Pure
 * function, no Web Crypto dependency.
 */
const hashRequestIdInput = (input: string): string => {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    hashA = Math.imul(hashA ^ code, 16777619);
    hashB = Math.imul(hashB + code, 2246822519) ^ (hashB >>> 13);
  }

  return `${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
};

const stableJsonStringify = (value: unknown): string => {
  return JSON.stringify(toStableJsonValue(value)) ?? 'undefined';
};

const toRequestIdFingerprintOp = (op: SyncOperation): SyncOperation => {
  return {
    ...op,
    payload: op.isPayloadEncrypted ? '[encrypted-payload]' : op.payload,
  };
};

const toStableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, toStableJsonValue((value as Record<string, unknown>)[key])]),
    );
  }

  return value;
};
