import { hashCaptureSecret, isCaptureSecretValid } from './capture-token';

/**
 * A reusable consent-page code for connector directory reviewers, bound to one
 * demo account. Reviewers test days later from the vendor's infrastructure,
 * where a single-use, 10-minute connect code from a running app cannot reach
 * them (docs/plans/2026-10-26-assistant-connector-directories.md § 6.6).
 * It only ever approves capture for that account, under the usual checks.
 */
export interface CaptureReviewAccess {
  email: string;
  /** SHA-256 of the normalized code; the code itself is not kept. */
  codeHash: string;
}

// Fits the consent page's 32-character field; at least 20 significant
// characters keep guessing infeasible under the approve rate limit.
const REVIEW_CODE_PATTERN = /^[A-Za-z0-9-]{20,32}$/;
const MIN_REVIEW_CODE_CHARS = 20;

/** The normalization the consent page applies to every code. */
export const normalizeCaptureCode = (code: string): string =>
  code.replace(/[-\s]/g, '').toUpperCase();

/** Both variables or neither; a partial or weak setting fails the boot. */
export const parseCaptureReviewAccess = (
  email: string | undefined,
  code: string | undefined,
): CaptureReviewAccess | undefined => {
  const trimmedEmail = email?.trim();
  const trimmedCode = code?.trim();
  if (!trimmedEmail && !trimmedCode) {
    return undefined;
  }
  if (!trimmedEmail || !trimmedCode) {
    throw new Error('Set both CAPTURE_REVIEW_EMAIL and CAPTURE_REVIEW_CODE, or neither.');
  }
  const normalized = normalizeCaptureCode(trimmedCode);
  if (
    !REVIEW_CODE_PATTERN.test(trimmedCode) ||
    normalized.length < MIN_REVIEW_CODE_CHARS
  ) {
    throw new Error(
      'CAPTURE_REVIEW_CODE must be 20 to 32 letters, digits or dashes, ' +
        'with at least 20 letters or digits.',
    );
  }
  return {
    email: trimmedEmail.toLowerCase(),
    codeHash: hashCaptureSecret(normalized),
  };
};

export const isCaptureReviewCode = (
  review: CaptureReviewAccess | undefined,
  code: string,
): review is CaptureReviewAccess =>
  !!review && isCaptureSecretValid(normalizeCaptureCode(code), review.codeHash);
