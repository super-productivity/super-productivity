require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const test = require('node:test');
const { migrateLogContent } = require('./log-migration-helper.ts');

test('migrates Log calls and updates the import for the target logger', () => {
  const input = [
    "import { Log, OtherLog } from '../core/log';",
    '',
    "Log.log('a');",
    "Log.err('b');",
    'OtherLog.log();',
    '',
  ].join('\n');

  const result = migrateLogContent(input, 'PluginLog');

  assert.equal(result.changes, 2);
  assert.equal(
    result.content,
    [
      "import { OtherLog, PluginLog } from '../core/log';",
      '',
      "PluginLog.log('a');",
      "PluginLog.err('b');",
      'OtherLog.log();',
      '',
    ].join('\n'),
  );
});

test('keeps the Log import when non-call Log references remain', () => {
  const input = [
    "import { Log } from '../core/log';",
    '',
    'const logger = Log;',
    "Log.info('a');",
    '',
  ].join('\n');

  const result = migrateLogContent(input, 'IssueLog');

  assert.equal(result.changes, 1);
  assert.equal(
    result.content,
    [
      "import { Log, IssueLog } from '../core/log';",
      '',
      'const logger = Log;',
      "IssueLog.info('a');",
      '',
    ].join('\n'),
  );
});
