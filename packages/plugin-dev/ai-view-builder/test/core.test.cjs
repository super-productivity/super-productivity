// Tests for the pure helpers in index.html's <script id="avb-core"> block.
// The block is loaded on its own in a VM context, the same code the iframe runs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const coreMatch = /<script id="avb-core">([\s\S]*?)<\/script>/.exec(indexHtml);
assert.ok(coreMatch, 'index.html must contain <script id="avb-core">');

const context = vm.createContext({ TextEncoder, crypto: globalThis.crypto });
vm.runInContext(coreMatch[1] + '\nthis.AVB = AVB;', context);
const AVB = context.AVB;

const VIEW =
  '<!doctype html>\n<html><head><title>My Board</title></head><body>hi</body></html>';

test('extractHtml returns a bare document unchanged', () => {
  assert.equal(AVB.extractHtml(VIEW), VIEW);
});

test('extractHtml strips prose and Markdown fences around the document', () => {
  const text = 'Here is your view:\n\n```html\n' + VIEW + '\n```\n\nEnjoy!';
  assert.equal(AVB.extractHtml(text), VIEW);
});

test('extractHtml keeps a closing html tag that appears inside a script string', () => {
  const doc = '<html><body><script>const s = "</html>";</' + 'script></body></html>';
  assert.equal(AVB.extractHtml(doc), doc);
});

test('extractHtml rejects a truncated document', () => {
  assert.equal(AVB.extractHtml('<!doctype html><html><body>cut off'), null);
  assert.equal(AVB.extractHtml(''), null);
  assert.equal(AVB.extractHtml('no html at all'), null);
});

test('extractTitle decodes entities, strips tags and caps the length', () => {
  assert.equal(AVB.extractTitle(VIEW), 'My Board');
  assert.equal(
    AVB.extractTitle('<title> Tasks &amp; <b>Time</b> </title>'),
    'Tasks & Time',
  );
  assert.equal(AVB.extractTitle('<title>' + 'x'.repeat(100) + '</title>').length, 60);
  assert.equal(AVB.extractTitle('<html></html>'), '');
});

test('the SSE parser and collector rebuild text split across chunks', () => {
  const collector = AVB.createStreamCollector();
  const parser = AVB.createSseParser(collector.onEvent);
  const events = [
    { type: 'message_start', message: {} },
    {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'hidden' },
    },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '<html>' } },
    { type: 'ping' },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '</html>' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ];
  const stream = events
    .map((e) => 'event: ' + e.type + '\r\ndata: ' + JSON.stringify(e) + '\r\n\r\n')
    .join('');
  for (let i = 0; i < stream.length; i += 7) {
    parser.push(stream.slice(i, i + 7));
  }
  parser.end();
  assert.equal(collector.state.text, '<html></html>');
  assert.equal(collector.state.stopReason, 'end_turn');
  assert.equal(collector.state.error, null);
});

test('the collector reports an error event', () => {
  const collector = AVB.createStreamCollector();
  const parser = AVB.createSseParser(collector.onEvent);
  parser.push(
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
  );
  assert.equal(collector.state.error, 'Overloaded');
});

test('buildRequest streams, sets effort and never sends sampling parameters', () => {
  const req = AVB.buildRequest({
    apiKey: 'k',
    model: 'claude-opus-5-5',
    prompt: 'a board',
  });
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['x-api-key'], 'k');
  assert.equal(req.headers['anthropic-version'], '2026-10-21');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.body.stream, true);
  assert.deepEqual(JSON.parse(JSON.stringify(req.body.output_config)), {
    effort: 'medium',
  });
  for (const field of ['temperature', 'top_p', 'top_k', 'thinking']) {
    assert.equal(field in req.body, false, field + ' must not be sent');
  }
  assert.equal(req.body.messages[0].content, 'Build this view:\n\na board');
});

test('buildRequest asks for server-side fallbacks only where the model supports them', () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    const req = AVB.buildRequest({ apiKey: 'k', model, prompt: 'p' });
    assert.equal(req.body.fallbacks, 'default', model);
    assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01', model);
  }
  const haiku = AVB.buildRequest({ apiKey: 'k', model: 'claude-haiku-5-5', prompt: 'p' });
  assert.equal('fallbacks' in haiku.body, false);
  assert.equal('anthropic-beta' in haiku.headers, false);
});

test('buildRequest falls back to the default model for an unknown id', () => {
  const req = AVB.buildRequest({ apiKey: 'k', model: 'gone-model', prompt: 'p' });
  assert.equal(req.body.model, AVB.DEFAULT_MODEL);
});

test('a change request carries the current source and earlier prompts', () => {
  const msg = AVB.buildUserMessage({
    prompt: 'make it blue',
    currentHtml: VIEW,
    earlierPrompts: ['a board\nwith columns', 'add counts'],
  });
  assert.ok(msg.includes('<current_view>\n' + VIEW + '\n</current_view>'));
  assert.ok(msg.includes('- a board with columns\n- add counts'));
  assert.ok(msg.trim().endsWith('make it blue'));
});

test('the view document puts the CSP before any generated markup', () => {
  const doc = AVB.buildViewDocument(
    '<!DOCTYPE html><html><head><script>evil()</' + 'script>',
    {
      themeCss: ':root{--bg:#fff}',
      channel: 'abc',
    },
  );
  const cspAt = doc.indexOf('Content-Security-Policy');
  assert.ok(cspAt > 0);
  assert.ok(cspAt < doc.indexOf('evil()'));
  assert.ok(doc.startsWith('<!doctype html><html><head><meta charset="utf-8">'));
  assert.equal(
    (doc.match(/<!doctype/gi) || []).length,
    1,
    'generated doctype is stripped',
  );
  assert.ok(doc.includes("default-src 'none'"));
});

test('the view document cannot be broken out of by host CSS', () => {
  const doc = AVB.buildViewDocument('<html></html>', {
    themeCss: 'a{}</style><script>bad()</script>',
    channel: 'abc',
  });
  assert.equal(doc.includes('</style><script>bad()'), false);
});

test('the view runtime is embedded with the method list, version and channel', () => {
  const doc = AVB.buildViewDocument('<html></html>', { themeCss: '', channel: 'chan-1' });
  assert.ok(doc.includes(JSON.stringify(AVB.VIEW_API_METHODS)));
  assert.ok(doc.includes(',' + AVB.VIEW_API_VERSION + ',"chan-1");'));
});

test('every sp method is documented for the model and handled by the host', () => {
  assert.equal(new Set(AVB.VIEW_API_METHODS).size, AVB.VIEW_API_METHODS.length);
  for (const method of AVB.VIEW_API_METHODS) {
    assert.ok(
      AVB.SYSTEM_PROMPT.includes('sp.' + method + '('),
      'prompt documents sp.' + method,
    );
    assert.match(
      indexHtml,
      new RegExp('\\n\\s+' + method + ': (async )?function'),
      'index.html has a viewApi handler for ' + method,
    );
  }
});

test('parseViewRecord validates synced entries', () => {
  assert.equal(AVB.parseViewRecord('not json'), null);
  assert.equal(AVB.parseViewRecord('{"id":"v1"}'), null);
  assert.equal(AVB.parseViewRecord('{"id":"v1","html":""}'), null);
  const view = AVB.parseViewRecord(
    JSON.stringify({ id: 'v1', html: VIEW, prompts: ['a', 3], title: '' }),
  );
  assert.equal(view.title, 'Untitled view');
  assert.deepEqual(Array.from(view.prompts), ['a']);
  assert.equal(view.apiVersion, AVB.VIEW_API_VERSION);
});

test('describeApiError maps common statuses to actionable messages', () => {
  assert.match(AVB.describeApiError(401, ''), /API key was rejected/);
  assert.match(AVB.describeApiError(429, ''), /Rate limited/);
  assert.match(AVB.describeApiError(529, ''), /overloaded/);
  assert.equal(
    AVB.describeApiError(400, '{"error":{"message":"bad input"}}'),
    'bad input',
  );
});

test('view ids are unique and safe as data keys', () => {
  const a = AVB.newViewId();
  const b = AVB.newViewId();
  assert.notEqual(a, b);
  assert.match(a, /^v[a-z0-9]+$/);
});
