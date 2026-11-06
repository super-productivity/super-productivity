import { CURRENT_SCHEMA_VERSION, SUPER_SYNC_IMPORT_REASONS } from '@sp/shared-schema';
import { OpType, Operation } from '../core/operation.types';
import {
  getOperationSchemaVersion,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../persistence/schema-migration.service';

const KNOWN_OP_TYPES: ReadonlySet<string> = new Set<string>(Object.values(OpType));
const KNOWN_IMPORT_REASONS: ReadonlySet<string> = new Set<string>(
  SUPER_SYNC_IMPORT_REASONS,
);

export type UnknownOpVocabulary = 'opType' | 'syncImportReason';

/**
 * Names the vocabulary field of a remote op this client cannot interpret, or
 * `null` when every value is known.
 *
 * The wire contract deliberately parses `opType` / `syncImportReason` as loose
 * strings (#8764) so a newer client's ops never wedge an older one at the
 * transport layer. The receiver must therefore make the call per op: an
 * unknown value means a newer client widened the vocabulary, and this client
 * can neither apply the op (unknown semantics) nor skip it (silent loss).
 */
export const getUnknownOpVocabulary = (
  op: Pick<Operation, 'opType' | 'syncImportReason'>,
): UnknownOpVocabulary | null => {
  // Only a PRESENT value can be unknown. Structural validity (opType is a
  // required non-empty string) is the transport schema's job, not this one's.
  if (isPresentUnknown(op.opType, KNOWN_OP_TYPES)) {
    return 'opType';
  }
  if (isPresentUnknown(op.syncImportReason, KNOWN_IMPORT_REASONS)) {
    return 'syncImportReason';
  }
  return null;
};

const isPresentUnknown = (value: unknown, known: ReadonlySet<string>): boolean =>
  typeof value === 'string' && !known.has(value);

/**
 * Why a remote batch stops at an op it cannot terminally process. Every reason
 * freezes the server cursor at the blocked op (see
 * `RemoteOpsProcessingService.processRemoteOps`). `MIGRATION_FAILED` is only
 * known after attempting the migration and is therefore not returned by
 * {@link getRemoteOpBlockReason}.
 */
export type RemoteOpBlockReason =
  | 'VERSION_UNSUPPORTED'
  | 'VERSION_TOO_NEW'
  | 'UNKNOWN_OP_VOCABULARY'
  | 'INVALID_SCHEMA_VERSION'
  | 'MIGRATION_FAILED';

/**
 * The ONE predicate for "this client cannot process this remote op", shared
 * by the processing loop and every pre-processing step that must not act on
 * (or prompt about) an op the loop will then refuse. Order matches the loop:
 * schema-version checks first, vocabulary second.
 */
export const getRemoteOpBlockReason = (
  op: Pick<Operation, 'opType' | 'syncImportReason'> & { schemaVersion?: unknown },
  currentVersion: number,
): Exclude<RemoteOpBlockReason, 'MIGRATION_FAILED'> | null => {
  let opVersion: number;
  try {
    opVersion = getOperationSchemaVersion(op);
  } catch {
    return 'INVALID_SCHEMA_VERSION';
  }
  // Below minimum supported version: no migration path exists.
  if (opVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return 'VERSION_UNSUPPORTED';
  }
  // Newer schema version: real migrations rename/split fields, so applying
  // a future op verbatim corrupts state.
  if (opVersion > currentVersion) {
    return 'VERSION_TOO_NEW';
  }
  // Unknown opType / syncImportReason: a newer client widened the wire
  // vocabulary without a schema bump (the default per the bump policy).
  // Same treatment as VERSION_TOO_NEW — block, lossless, update-app UX —
  // never skip: advancing the cursor past an op this client never
  // understood is silent data loss.
  if (getUnknownOpVocabulary(op) !== null) {
    return 'UNKNOWN_OP_VOCABULARY';
  }
  return null;
};

/**
 * Everything before the first op {@link getRemoteOpBlockReason} would block
 * on. `processRemoteOps` stops at that op, so pre-processing steps (e.g. the
 * full-state conflict gate) must not act on — or prompt the user about —
 * anything from it onwards.
 */
export const takeInterpretableOpPrefix = <
  T extends Pick<Operation, 'opType' | 'syncImportReason'> & { schemaVersion?: unknown },
>(
  ops: readonly T[],
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): T[] => {
  const blockedIndex = ops.findIndex(
    (op) => getRemoteOpBlockReason(op, currentVersion) !== null,
  );
  return blockedIndex === -1 ? [...ops] : ops.slice(0, blockedIndex);
};
