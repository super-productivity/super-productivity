/**
 * Privacy-aware logger port for sync-core code.
 *
 * Log history may be exportable by host apps. Metadata passed through this port
 * must stay limited to safe primitives such as IDs, counts, action strings,
 * entity types, op IDs, and sanitized error identities. Do not log full
 * entities, operation payloads, user text, raw provider responses,
 * credentials, or encryption material.
 */

export type SyncLogMeta = Record<string, string | number | boolean | null | undefined>;

export interface SyncLogError {
  name: string;
  code?: string | number;
}

export const toSyncLogError = (error: unknown): SyncLogError => {
  if (error instanceof Error) {
    return { name: error.name || 'Error' };
  }

  if (typeof error === 'object' && error !== null) {
    const errorLike = error as { name?: unknown; code?: unknown };
    const name = typeof errorLike.name === 'string' ? errorLike.name : undefined;
    const code =
      typeof errorLike.code === 'string' || typeof errorLike.code === 'number'
        ? errorLike.code
        : undefined;

    return {
      name: name || 'ObjectError',
      ...(code !== undefined ? { code } : {}),
    };
  }

  return { name: typeof error === 'string' ? 'StringError' : 'UnknownError' };
};

export interface SyncLogger {
  log(message: string, meta?: SyncLogMeta): void;
  error(message: string, error?: SyncLogError, meta?: SyncLogMeta): void;
  err(message: string, error?: SyncLogError, meta?: SyncLogMeta): void;
  normal(message: string, meta?: SyncLogMeta): void;
  verbose(message: string, meta?: SyncLogMeta): void;
  info(message: string, meta?: SyncLogMeta): void;
  warn(message: string, meta?: SyncLogMeta): void;
  critical(message: string, meta?: SyncLogMeta): void;
  debug(message: string, meta?: SyncLogMeta): void;
}

const noop = (): void => undefined;

export const NOOP_SYNC_LOGGER: SyncLogger = {
  log: noop,
  error: noop,
  err: noop,
  normal: noop,
  verbose: noop,
  info: noop,
  warn: noop,
  critical: noop,
  debug: noop,
};
