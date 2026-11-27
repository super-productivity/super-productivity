const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildIndex, suggest, buildComment, cleanBody } = require('./docs-suggest');
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

for (const fixture of FIXTURES) {
  test(`#${fixture.n} (${fixture.expect}): ${fixture.title}`, () => {
    const links = suggest(index, fixture).map((link) => pathOf(link.url));
    const wrong = links.filter((link) => !fixture.ok.includes(link));
    assert.deepEqual(wrong, [], 'never post a wrong link');
    if (fixture.expect === 'silent') assert.deepEqual(links, []);
    assert.ok(links.length <= 3);
  });
}

test('recall floor: most questions a page clearly answers get a link', () => {
  // Regression guard, not a target: term matching misses questions that don't use the
  // page's words (#9343 "time detection" -> Short Syntax). Raise the floor when recall improves.
  const answerable = FIXTURES.filter((fixture) => fixture.expect === 'hit');
  const found = answerable.filter((fixture) => suggest(index, fixture).length > 0);
  assert.ok(found.length >= 6, `${found.length}/${answerable.length} answered`);
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
