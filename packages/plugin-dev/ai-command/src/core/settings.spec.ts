import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

test('broken or unknown stored settings fall back to the defaults', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('{not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('null'), DEFAULT_SETTINGS);
  assert.deepEqual(
    parseSettings('{"model":"gpt-x","isApplyWithoutReview":"yes"}'),
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    parseSettings('{"model":"claude-opus-5-5","isApplyWithoutReview":true}'),
    {
      ...DEFAULT_SETTINGS,
      model: 'claude-opus-5-5',
      isApplyWithoutReview: true,
    },
  );
});
