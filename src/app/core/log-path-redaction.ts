// Logs are exportable and routinely pasted into public bug reports (see the
// header of log.ts). Absolute paths embed the operating system user name —
// `C:\\Users\\alice\\...`, `/home/alice/...`, `/Users/alice/...` — so every
// home-directory prefix is collapsed to `<home>` before the history leaves the
// app. Both the Windows and the Linux/macOS layouts are covered, inside plain
// messages as well as inside stack traces.
//
// Keep in sync with electron/log-path-redaction.ts: the Electron main process
// ships without src/, so the helper exists there as a small duplicate.
export const REDACTED_HOME_DIR = '<home>';

const HOME_DIR_PATTERNS: readonly RegExp[] = [
  // C:\Users\\alice\AppData\... (and the C:/Users/alice/... spelling)
  /[A-Za-z]:\\+Users\\+[^\\\r\n"'<>|]+/g,
  /[A-Za-z]:\/+Users\/+[^/\r\n"'<>|]+/g,
  // /home/alice/...
  /\/home\/[^/\r\n"'<>|]+/g,
  // /Users/alice/... (macOS)
  /\/Users\/[^/\r\n"'<>|]+/g,
  // /root
  /\/root(?=[/\s"']|$)/g,
];

export const redactLogPaths = (text: string): string => {
  if (!text || (!text.includes('/') && !text.includes('\\'))) {
    return text;
  }
  return HOME_DIR_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, REDACTED_HOME_DIR),
    text,
  );
};

/** Deep-redacts every string of an already serializable value (log history). */
export const redactLogValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return redactLogPaths(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        redactLogValue(val),
      ]),
    );
  }
  return value;
};
