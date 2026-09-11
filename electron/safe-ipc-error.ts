import { IPC } from './shared-with-frontend/ipc-events.const';

export const getSafeErrorMeta = (
  e: unknown,
): {
  errorName: string;
  errorCode?: string | number;
} => {
  const errorName =
    e instanceof Error
      ? e.name
      : typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string'
        ? e.name
        : 'UnknownError';
  const errorCode =
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (typeof e.code === 'string' || typeof e.code === 'number')
      ? e.code
      : undefined;

  return errorCode === undefined ? { errorName } : { errorName, errorCode };
};

export const createSafeIpcError = (operation: IPC, e: unknown): Error => {
  const { errorName, errorCode } = getSafeErrorMeta(e);
  const codeMessagePart = errorCode === undefined ? '' : ` (code: ${errorCode})`;
  const safeError = new Error(`${operation} failed: ${errorName}${codeMessagePart}`, {
    cause: { name: errorName, code: errorCode },
  }) as Error & { code?: string | number };
  safeError.name = errorName;
  if (errorCode !== undefined) {
    safeError.code = errorCode;
  }
  delete safeError.stack;

  return safeError;
};
