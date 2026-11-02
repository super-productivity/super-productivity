import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from './html';

test('escapeHtml: neutralizes markup in task titles', () => {
  assert.equal(
    escapeHtml(`<img src="x" onerror='y'> & co`),
    '&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt; &amp; co',
  );
  assert.equal(escapeHtml('Plain title'), 'Plain title');
});
