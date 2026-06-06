import { InjectionToken } from '@angular/core';
import type { SyncLogError, SyncLogger, SyncLogMeta } from '@sp/sync-core';
import { OpLog } from '../../core/log';

type LogMethod = (...args: unknown[]) => void;

const forwardWithMeta = (
  logMethod: LogMethod,
  message: string,
  meta?: SyncLogMeta,
): void => {
  if (meta === undefined) {
    logMethod(message);
  } else {
    logMethod(message, meta);
  }
};

const forwardWithError = (
  logMethod: LogMethod,
  message: string,
  error?: SyncLogError,
  meta?: SyncLogMeta,
): void => {
  if (error !== undefined && meta !== undefined) {
    logMethod(message, error, meta);
  } else if (error !== undefined) {
    logMethod(message, error);
  } else {
    forwardWithMeta(logMethod, message, meta);
  }
};

export const OP_LOG_SYNC_LOGGER: SyncLogger = {
  log: (message, meta) => forwardWithMeta(OpLog.log, message, meta),
  error: (message, error, meta) => forwardWithError(OpLog.error, message, error, meta),
  err: (message, error, meta) => forwardWithError(OpLog.err, message, error, meta),
  normal: (message, meta) => forwardWithMeta(OpLog.normal, message, meta),
  verbose: (message, meta) => forwardWithMeta(OpLog.verbose, message, meta),
  info: (message, meta) => forwardWithMeta(OpLog.info, message, meta),
  warn: (message, meta) => forwardWithMeta(OpLog.warn, message, meta),
  critical: (message, meta) => forwardWithMeta(OpLog.critical, message, meta),
  debug: (message, meta) => forwardWithMeta(OpLog.debug, message, meta),
};

export const SYNC_LOGGER = new InjectionToken<SyncLogger>('SYNC_LOGGER', {
  providedIn: 'root',
  factory: () => OP_LOG_SYNC_LOGGER,
});
