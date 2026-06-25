import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { type MarkdownSanitizerWindow, sanitizeMarkdownHtml } from './markdown-sanitizer';

const sanitize = (html: string): string => {
  const { window } = new JSDOM('');
  return sanitizeMarkdownHtml(html, window as unknown as MarkdownSanitizerWindow);
};

test('sanitizeMarkdownHtml removes active HTML and event handlers', () => {
  const html = sanitize(
    '<h1 onclick="alert(1)">Title</h1><script>alert(1)</script><iframe src="https://example.com"></iframe><p>Body</p>',
  );

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<p>Body<\/p>/);
  assert.doesNotMatch(html, /onclick|script|iframe|alert/);
});

test('sanitizeMarkdownHtml strips unsafe link protocols and preserves safe links', () => {
  const html = sanitize(
    '<a href="javascript:alert(1)">bad</a><a href="https://example.com">web</a><a href="notes/foo.md">note</a><a href="mailto:test@example.com">mail</a>',
  );

  assert.match(html, /<a[^>]*>bad<\/a>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /href="notes\/foo\.md"/);
  assert.match(html, /href="mailto:test@example.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer"/);
});

test('sanitizeMarkdownHtml allows only local image sources', () => {
  const html = sanitize(
    '<img src="images/local.png" alt="local"><img src="file:///tmp/local.png" alt="file"><img src="https://example.com/tracker.png" alt="remote"><img src="//example.com/tracker.png" alt="protocol"><img src="data:image/svg+xml,<svg></svg>" alt="data">',
  );

  assert.match(html, /src="images\/local\.png"/);
  assert.match(html, /src="file:\/\/\/tmp\/local\.png"/);
  assert.doesNotMatch(html, /https:\/\/example\.com|\/\/example\.com|data:image/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /referrerpolicy="no-referrer"/);
});

test('sanitizeMarkdownHtml keeps markdown table, list, and code output', () => {
  const html = sanitize(
    '<table><thead><tr><th align="left">A</th></tr></thead><tbody><tr><td align="left">B</td></tr></tbody></table><ul><li>One</li></ul><pre><code>const x = 1;</code></pre>',
  );

  assert.match(html, /<table>/);
  assert.match(html, /<th align="left">A<\/th>/);
  assert.match(html, /<ul><li>One<\/li><\/ul>/);
  assert.match(html, /<pre><code>const x = 1;<\/code><\/pre>/);
});
