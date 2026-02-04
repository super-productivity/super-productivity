import { environment } from '../../environments/environment';

export enum LogLevel {
  CRITICAL = 0,
  ERROR = 1,
  NORMAL = 2,
  VERBOSE = 3,
  DEBUG = 4,
}

interface LogEntry {
  time: string;
  lvl: string;
  ctx: string;
  msg: string;
  args: unknown[];
}

const LOG_LEVEL = environment.production ? LogLevel.VERBOSE : LogLevel.VERBOSE;

const MAX_DATA_LENGTH = 400;

const truncateSerialized = (value: string): string =>
  value.length > MAX_DATA_LENGTH ? 'short:' + value.substring(0, MAX_DATA_LENGTH) : value;

const isDomRelatedObject = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  // Check if DOM constructors exist before using instanceof
  // This prevents crashes in non-DOM environments (workers, Electron main, SSR tests)
  if (typeof HTMLCollection !== 'undefined' && value instanceof HTMLCollection) {
    return true;
  }
  if (typeof NodeList !== 'undefined' && value instanceof NodeList) {
    return true;
  }
  if (typeof Element !== 'undefined' && value instanceof Element) {
    return true;
  }

  return false;
};

const formatDomObjectLabel = (value: { constructor?: { name?: string } }): string =>
  `[DOM: ${value.constructor?.name ?? 'unknown'}]`;

const serializeErrorMessage = (error: Error): string => truncateSerialized(String(error));

const serializeErrorArg = (error: Error): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error.stack) {
    result.stack = error.stack;
  }

  return result;
};

// IMPORTANT: All Log class methods and context loggers (SyncLog, etc.) record logs to history
// for later export. The trade-off is that line numbers will show log.ts instead of the
// actual calling location. This is a fundamental limitation of JavaScript - any wrapper
// function breaks line number preservation.
//
// Available logging methods:
// 1. Direct console.log() - preserves line numbers but NO recording
// 2. Log.normal() etc - records to history (shows log.ts line numbers)
// 3. SyncLog.error() etc - records to history with context (shows log.ts line numbers)

/**
 * Modern logging class that preserves line numbers using pre-bound console methods
 */
export class Log {
  /** Current log level threshold */
  private static level: LogLevel = LOG_LEVEL;

  /** Current context string */
  private static context: string = '';

  /** Array to store log entries for download */
  private static logHistory: LogEntry[] = [];

  /** Maximum number of log entries to keep in memory */
  private static maxHistorySize: number = 1000;

  /** Pre-bound console functions that preserve line numbers */
  private static readonly c = console.log.bind(console); // critical
  private static readonly e = (console.error || console.log).bind(console);
  private static readonly w = (console.warn || console.log).bind(console);
  private static readonly l = console.log.bind(console); // log (formerly normal)
  private static readonly i = (console.info || console.log).bind(console); // info
  private static readonly v = console.log.bind(console); // verbose
  private static readonly d = (console.debug || console.log).bind(console);

  /** Set the logging level dynamically */
  static setLevel(lvl: LogLevel): void {
    this.level = lvl;
  }

  /** Set the context for subsequent log messages */
  static setContext(ctx: string): void {
    this.context = ctx;
  }

  /** Get formatted prefix with context */
  private static getPrefix(): string {
    return this.context.length ? `[${this.context}]` : '';
  }

  /** Record log entry to history */
  private static recordLog(level: string, context: string, args: unknown[]): void {
    // Safely serialize the first argument for the message field
    let msg = '';
    if (args.length > 0) {
      try {
        const firstArg = args[0];
        if (typeof firstArg === 'string') {
          msg = firstArg;
        } else if (firstArg instanceof Error) {
          msg = serializeErrorMessage(firstArg);
        } else if (typeof firstArg === 'object' && firstArg !== null) {
          // Handle DOM objects (HTMLCollection, NodeList, etc.)
          if (isDomRelatedObject(firstArg)) {
            msg = formatDomObjectLabel(firstArg as { constructor?: { name?: string } });
          } else {
            // Try to serialize objects to JSON
            const serialized = JSON.stringify(firstArg);
            msg = truncateSerialized(serialized);
          }
        } else {
          msg = String(firstArg);
        }
      } catch {
        // Fallback for circular references or other serialization errors
        msg = String(args[0]);
      }
    }

    const entry: LogEntry = {
      time: new Date().toISOString(),
      lvl: level,
      ctx: context,
      msg: msg,
      args: args.slice(1),
    };

    this.logHistory.push(entry);

    // Keep history size under control
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory = this.logHistory.slice(-this.maxHistorySize);
    }
  }

  static critical(...args: unknown[]): void {
    // Critical always logs (level 0)
    this.recordLog('CRITICAL', this.context, args);
    this.c(this.getPrefix(), ...args);
  }

  static err(...args: unknown[]): void {
    if (this.level >= LogLevel.ERROR) {
      this.recordLog('ERROR', this.context, args);
      this.e(this.getPrefix(), ...args);
    }
  }

  static warn(...args: unknown[]): void {
    if (this.level >= LogLevel.ERROR) {
      this.recordLog('WARN', this.context, args);
      this.w(this.getPrefix(), ...args);
    }
  }

  static log(...args: unknown[]): void {
    if (this.level >= LogLevel.NORMAL) {
      this.recordLog('LOG', this.context, args);
      this.l(this.getPrefix(), ...args);
    }
  }

  static info(...args: unknown[]): void {
    if (this.level >= LogLevel.NORMAL) {
      this.recordLog('INFO', this.context, args);
      this.i(this.getPrefix(), ...args);
    }
  }

  static verbose(...args: unknown[]): void {
    if (this.level >= LogLevel.VERBOSE) {
      this.recordLog('VERBOSE', this.context, args);
      this.v(this.getPrefix(), ...args);
    }
  }

  static debug(...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      this.recordLog('DEBUG', this.context, args);
      this.d(this.getPrefix(), ...args);
    }
  }

  // special helper to make a specially visible log
  static x(...args: unknown[]): void {
    if (this.level >= LogLevel.NORMAL) {
      this.recordLog('LOG', this.context, args);
      this.l('XXXXXXX: ', ...args);
    }
  }

  // Backwards compatibility aliases
  static error = Log.err;
  static normal = Log.log;

  /** Get the current log history */
  static getLogHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  /** Clear the log history */
  static clearLogHistory(): void {
    this.logHistory = [];
  }

  /** Export log history as JSON string for download */
  static exportLogHistory(): string {
    // Safe JSON serialization to avoid circular structure errors
    const safeHistory = this.logHistory.map((entry) => ({
      timestamp: entry.time,
      level: entry.lvl,
      context: entry.ctx,
      message: entry.msg,
      args: entry.args.map((arg) => {
        try {
          // Handle DOM objects
          if (isDomRelatedObject(arg)) {
            return formatDomObjectLabel(arg as { constructor?: { name?: string } });
          }
          if (arg instanceof Error) {
            return serializeErrorArg(arg);
          }
          // Try to serialize each arg safely
          const r = JSON.stringify(arg);
          if (r.length > MAX_DATA_LENGTH) {
            return 'short:' + r.substring(0, MAX_DATA_LENGTH);
          }
          return JSON.parse(r);
        } catch {
          // If circular reference or any other error, convert to string representation
          return String(arg);
        }
      }),
    }));

    return JSON.stringify(safeHistory, null, 2);
  }

  /** Export log history as formatted text for download */
  static exportLogHistoryAsText(): string {
    return this.logHistory
      .map((entry) => {
        const date = new Date(entry.time).toISOString();
        const context = entry.ctx ? `[${entry.ctx}] ` : '';
        const argsStr =
          entry.args.length > 0 ? ` ${entry.args.map(String).join(' ')}` : '';
        return `${date} [${entry.lvl}] ${context}${entry.msg}${argsStr}`;
      })
      .join('\n');
  }

  /**
   * Create a new logger instance with a specific context
   * All logs are recorded to history for later export
   * @param context - The context string to prefix logs with
   */
  static withContext(context: string): {
    critical: (...args: unknown[]) => void;
    err: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    verbose: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    // Backwards compatibility aliases
    error: (...args: unknown[]) => void;
    normal: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  } {
    const contextPrefix = `[${context}]`;

    // Return wrapper functions that always record logs
    // Note: Using explicit Log.level instead of this.level to ensure correct
    // static property access in test environments where this binding may vary
    return {
      critical: (...args: unknown[]) => {
        Log.recordLog('CRITICAL', context, args);
        console.log(contextPrefix, ...args);
      },
      err: (...args: unknown[]) => {
        if (Log.level >= LogLevel.ERROR) {
          Log.recordLog('ERROR', context, args);
          console.error(contextPrefix, ...args);
        }
      },
      log: (...args: unknown[]) => {
        if (Log.level >= LogLevel.NORMAL) {
          Log.recordLog('LOG', context, args);
          console.log(contextPrefix, ...args);
        }
      },
      info: (...args: unknown[]) => {
        if (Log.level >= LogLevel.NORMAL) {
          Log.recordLog('INFO', context, args);
          console.info(contextPrefix, ...args);
        }
      },
      verbose: (...args: unknown[]) => {
        if (Log.level >= LogLevel.VERBOSE) {
          Log.recordLog('VERBOSE', context, args);
          console.log(contextPrefix, ...args);
        }
      },
      debug: (...args: unknown[]) => {
        if (Log.level >= LogLevel.DEBUG) {
          Log.recordLog('DEBUG', context, args);
          console.debug(contextPrefix, ...args);
        }
      },
      // Backwards compatibility aliases
      error: (...args: unknown[]) => {
        if (Log.level >= LogLevel.ERROR) {
          Log.recordLog('ERROR', context, args);
          console.error(contextPrefix, ...args);
        }
      },
      normal: (...args: unknown[]) => {
        if (Log.level >= LogLevel.NORMAL) {
          Log.recordLog('LOG', context, args);
          console.log(contextPrefix, ...args);
        }
      },
      warn: (...args: unknown[]) => {
        if (Log.level >= LogLevel.ERROR) {
          Log.recordLog('WARN', context, args);
          console.warn(contextPrefix, ...args);
        }
      },
    };
  }
}

// Pre-configured logger instances for specific contexts
// All context loggers now record to history
export const SyncLog = Log.withContext('sync');
export const OpLog = Log.withContext('ol');
export const PluginLog = Log.withContext('plugin');
export const IssueLog = Log.withContext('issue');
export const DroidLog = Log.withContext('droid');
export const TaskLog = Log.withContext('task');
