// Mirrors src/app/core/log-path-redaction.ts. The Electron main process ships
// without src/ (electron-builder only packages electron/**), so this small
// helper is duplicated here; keep the two files and their tests in sync.
export const REDACTED_HOME_DIR = '<home>';

const HOME_DIR_PATTERNS: readonly RegExp[] = [
  /[A-Za-z]:\\+Users\\+[^\\\r\n"'<>|]+/g,
  /[A-Za-z]:\/+Users\/+[^/\r\n"'<>|]+/g,
  /\/home\/[^/\r\n"'<>|]+/g,
  /\/Users\/[^/\r\n"'<>|]+/g,
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

/** electron-log hook payload: strings and Error objects (stack/message). */
export const redactLogDatum = (datum: unknown): unknown => {
  if (typeof datum === 'string') {
    return redactLogPaths(datum);
  }
  if (datum instanceof Error) {
    const redacted = new Error(redactLogPaths(datum.message));
    redacted.name = datum.name;
    if (datum.stack) {
      redacted.stack = redactLogPaths(datum.stack);
    }
    return redacted;
  }
  return datum;
};
