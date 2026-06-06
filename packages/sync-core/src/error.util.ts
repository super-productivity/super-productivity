/**
 * Extracts a meaningful error message from common thrown-value shapes.
 *
 * This helper intentionally does not log. Hosts decide whether an extracted
 * message is safe for their user-visible or exportable diagnostics.
 */
export const extractErrorMessage = (err: unknown): string | null => {
  if (typeof err === 'string' && err.length > 0) {
    return err;
  }

  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return cause.message;
    }

    const code = (err as Error & { code?: string }).code;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }

    if (err.message && err.message.length > 0) {
      return err.message;
    }
  }

  if (
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    const msg = (err as { message: string }).message;
    if (msg.length > 0) {
      return msg;
    }
  }

  return null;
};
