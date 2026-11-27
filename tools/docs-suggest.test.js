const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildIndex,
  candidates,
  formatCandidates,
  pickLinks,
  buildComment,
  cleanBody,
} = require('./docs-suggest');
const { FIXTURES } = require('./docs-suggest.fixtures');

// Runs against the real docs on purpose: the fixtures check real questions against real pages.
// Renaming or retitling a page can fail these tests; update the fixture's `ok` paths then.
const WIKI = path.join(__dirname, '..', 'docs', 'wiki');
const DOCS = 'https://super-productivity.com/docs/';
const index = buildIndex(WIKI);
const pathOf = (url) => url.slice(DOCS.length).replace(/\/$/, '');

test('index holds published content pages only, with website URLs', () => {
  const urls = new Set(index.map((page) => page.url));
  assert.ok(urls.has(`${DOCS}how-to/restore-data-from-backup/`));
  assert.ok(urls.has(`${DOCS}explanation/idle-time/`));
  // section pages, the docs home and unpublished pages are not useful answers
  assert.ok(!urls.has(`${DOCS}how-to/`));
  assert.ok(!urls.has(DOCS));
  const parsed = index.map((page) => new URL(page.url));
  assert.ok(!parsed.some((url) => url.pathname.endsWith('/quick-history/')));
  assert.ok(
    parsed.every((url) => url.origin === new URL(DOCS).origin && url.search === ''),
  );
});

test('shortlist: the right page is a candidate for most answerable questions', () => {
  // Regression guard, not a target: the model can only pick a page that is shortlisted.
  // Term matching misses questions that don't use the page's words (#9343 "time detection"
  // -> Short Syntax). Raise the floor when retrieval improves.
  const answerable = FIXTURES.filter((fixture) => fixture.ok.length > 0);
  const found = answerable.filter((fixture) =>
    candidates(index, fixture).some((page) => fixture.ok.includes(pathOf(page.url))),
  );
  assert.ok(found.length >= 25, `${found.length}/${answerable.length} shortlisted`);
});

test('shortlist: at most 8 published pages, best first', () => {
  for (const fixture of FIXTURES) {
    const pages = candidates(index, fixture);
    assert.ok(pages.length <= 8);
    assert.deepEqual(
      pages.map((page) => page.score),
      [...pages.map((page) => page.score)].sort((a, b) => b - a),
    );
  }
});

test('formatCandidates numbers the pages from 1 and shows only title and description', () => {
  const text = formatCandidates([
    { title: 'Idle Time', description: 'What counts as idle.', url: `${DOCS}x/` },
    { title: 'Worklog', description: '', url: `${DOCS}y/` },
  ]);
  assert.equal(text, '1. Idle Time: What counts as idle.\n2. Worklog');
});

const PAGES = ['A', 'B', 'C', 'D'].map((title) => ({
  title,
  url: `${DOCS}${title.toLowerCase()}/`,
  score: 1,
}));

test('pickLinks keeps only listed page numbers, in order, at most 3', () => {
  const titles = (response) => pickLinks(response, PAGES).map((link) => link.title);
  assert.deepEqual(titles('{"pages": [2]}'), ['B']);
  assert.deepEqual(titles('{"pages": [3, 1]}'), ['C', 'A']);
  assert.deepEqual(titles('{"pages": [1, 2, 3, 4]}'), ['A', 'B', 'C']);
  assert.deepEqual(titles('{"pages": [2, 2]}'), ['B']);
  assert.deepEqual(titles('{"pages": []}'), []);
});

test('pickLinks: an invented, malformed or chatty reply adds no link', () => {
  for (const response of [
    '{"pages": [0, 5, 99]}',
    '{"pages": ["1", 1.5, null]}',
    '{"pages": "1"}',
    '{"related": [1]}',
    'Page 1 answers it: {"pages": [1]}',
    '```json\n{"pages": [1]}\n```',
    '',
    undefined,
  ]) {
    assert.deepEqual(pickLinks(response, PAGES), [], String(response));
  }
});

test('buildComment: one short reply, plain links, closing next step', () => {
  const comment = buildComment([
    { title: 'Idle Time', url: `${DOCS}explanation/idle-time/` },
  ]);
  assert.match(
    comment,
    /\[Idle Time\]\(https:\/\/super-productivity\.com\/docs\/explanation\/idle-time\/\)/,
  );
  assert.match(
    comment,
    /If this doesn't answer it, reply here and someone will follow up\.$/,
  );
  assert.equal(buildComment([]), null);
});

test('cleanBody drops code, images, links and HTML so they cannot drive a match', () => {
  const body =
    'Sync fails\n```\nrestore backup\n```\n![shot](https://x/y.png) <img src="a"> see https://example.com/idle';
  assert.equal(cleanBody(body).replace(/\s+/g, ' ').trim(), 'Sync fails see');
});
