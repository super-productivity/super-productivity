import { UploadOutcome } from '../core/types/sync-results.types';

type CompletedUploadOutcome = Extract<UploadOutcome, { kind: 'completed' }>;

/**
 * Ops the server rejected with a retryable INTERNAL_ERROR (e.g. a Postgres
 * serialization conflict). They stay pending locally and are re-sent by the
 * sync wrapper's bounded re-upload loop.
 */
export const countTransientRejections = (result: CompletedUploadOutcome): number =>
  result.rejectedOps.filter((op) => op.errorCode === 'INTERNAL_ERROR').length;
