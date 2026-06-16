import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeMarkdownImageUrl, isSafeMarkdownLinkUrl } from './url-safety';

test('isSafeMarkdownLinkUrl rejects dangerous explicit protocols', () => {
  assert.equal(isSafeMarkdownLinkUrl('javascript:alert(1)'), false);
  assert.equal(isSafeMarkdownLinkUrl('  data:text/html,<script></script>  '), false);
});

test('isSafeMarkdownLinkUrl allows normal relative and web links', () => {
  assert.equal(isSafeMarkdownLinkUrl('notes/foo.md'), true);
  assert.equal(isSafeMarkdownLinkUrl('./javascript:alert(1)'), true);
  assert.equal(isSafeMarkdownLinkUrl('#heading'), true);
  assert.equal(isSafeMarkdownLinkUrl('https://example.com/note'), true);
  assert.equal(isSafeMarkdownLinkUrl('mailto:test@example.com'), true);
});

test('isSafeMarkdownImageUrl allows only local image sources', () => {
  assert.equal(isSafeMarkdownImageUrl('images/foo.png'), true);
  assert.equal(isSafeMarkdownImageUrl('/images/foo.png'), true);
  assert.equal(isSafeMarkdownImageUrl('file:///home/user/vault/foo.png'), true);
});

test('isSafeMarkdownImageUrl rejects remote and dangerous image sources', () => {
  assert.equal(isSafeMarkdownImageUrl('https://example.com/tracker.png'), false);
  assert.equal(isSafeMarkdownImageUrl('http://example.com/tracker.png'), false);
  assert.equal(isSafeMarkdownImageUrl('//example.com/tracker.png'), false);
  assert.equal(isSafeMarkdownImageUrl('javascript:alert(1)'), false);
  assert.equal(isSafeMarkdownImageUrl('data:image/svg+xml,<svg></svg>'), false);
});
