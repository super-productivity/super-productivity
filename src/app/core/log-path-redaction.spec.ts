import { REDACTED_HOME_DIR, redactLogPaths, redactLogValue } from './log-path-redaction';

describe('redactLogPaths()', () => {
  it('should redact a Windows user profile path', () => {
    const text =
      'C:\\Users\\alice\\AppData\\Local\\Temp\\3LBW\\resources\\app.asar\\electron\\x.js';

    expect(redactLogPaths(text)).toBe(
      REDACTED_HOME_DIR +
        '\\AppData\\Local\\Temp\\3LBW\\resources\\app.asar\\electron\\x.js',
    );
  });

  it('should redact a Windows user profile path with forward slashes', () => {
    expect(redactLogPaths('C:/Users/alice/AppData/app.asar')).toBe(
      REDACTED_HOME_DIR + '/AppData/app.asar',
    );
  });

  it('should redact a Linux home directory', () => {
    expect(redactLogPaths('/home/asic/Planflow/SuperProductivity/app.asar/a.js')).toBe(
      REDACTED_HOME_DIR + '/Planflow/SuperProductivity/app.asar/a.js',
    );
  });

  it('should redact a macOS home directory', () => {
    expect(redactLogPaths('/Users/bob/Library/Application Support/x')).toBe(
      REDACTED_HOME_DIR + '/Library/Application Support/x',
    );
  });

  it('should redact a bare home directory without a trailing separator', () => {
    expect(redactLogPaths('backups stored in /home/asic')).toBe(
      'backups stored in ' + REDACTED_HOME_DIR,
    );
  });

  it('should redact paths inside a stack trace', () => {
    const stack = [
      'Error: Global Shortcut registration failed: Ctrl+Shift+X',
      '    at errorHandlerWithFrontendInform (C:\\Users\\alice\\AppData\\Local\\Temp\\3LBW\\resources\\app.asar\\electron\\error-handler-with-frontend-inform.js:9:20)',
      '    at /home/asic/Planflow/SuperProductivity/resources/app.asar/electron/ipc-handlers/global-shortcuts.js:61:97',
    ].join('\n');

    const result = redactLogPaths(stack);

    expect(result).not.toContain('alice');
    expect(result).not.toContain('asic');
    expect(result).toContain('<home>\\AppData\\Local\\Temp');
    expect(result).toContain('<home>/Planflow/SuperProductivity');
  });

  it('should leave unrelated absolute paths alone', () => {
    const text = 'restore failed: /var/lib/app/data.json and D:\\backup\\dump.json';

    expect(redactLogPaths(text)).toBe(text);
  });

  it('should not touch messages without a path separator', () => {
    const text = 'task selected: 42 users: 3';

    expect(redactLogPaths(text)).toBe(text);
  });

  it('should be idempotent', () => {
    const once = redactLogPaths('/home/asic/x/C:\\Users\\alice\\y');

    expect(redactLogPaths(once)).toBe(once);
  });
});

describe('redactLogValue()', () => {
  it('should redact strings in nested structures', () => {
    const value = {
      message: 'failed at /home/asic/x.js',
      args: [{ stack: 'at C:\\Users\\alice\\y.js:1:2' }, 42, true, null],
    };

    const result = redactLogValue(value) as typeof value;

    expect(result.message).toBe('failed at <home>/x.js');
    expect(JSON.stringify(result)).not.toContain('asic');
    expect(JSON.stringify(result)).not.toContain('alice');
    expect(result.args[1]).toBe(42);
    expect(result.args[2]).toBe(true);
    expect(result.args[3]).toBeNull();
  });
});
